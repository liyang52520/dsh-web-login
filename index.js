/**
 * dsh-web-login — a password gate for the DeepSeek Harness Web GUI.
 *
 * Harness already authenticates its own browser session, but the credential is
 * the one-time token printed by `dsh web`, so anyone who reads that URL (a log,
 * a chat message, a proxy access log) is in. This plugin adds an independent
 * password layer in front of the document surface:
 *
 *   * `/` is owned by the plugin. It serves the login page until the browser
 *     holds a gate cookie, and only then forwards the launch token to Harness
 *     to mint Harness's own session cookie. The token is useless without the
 *     password, which is the whole point.
 *   * `/index.html` is owned too when the frontend bundle can be resolved, so
 *     the app document is never reachable around the gate.
 *   * `/api` and every other route are untouched: Harness still applies its own
 *     Host/Origin fence and browser authentication underneath.
 *
 * The plugin is host-only and dependency-free: it is a plain Cordis plugin with
 * named `name`/`inject`/`apply` exports and no imports beyond `node:` builtins.
 * @module dsh-web-login
 */

import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { loginPage, messagePage, setupPage } from "./page.js";

/** Stable Cordis plugin name; also the credential-record scope. */
export const name = "dsh-web-login";
/** Services that must exist before the gate can claim routes. */
export const inject = ["webServer", "connection", "credentials"];

const scrypt = promisify(scryptCallback);

/** Credential record key owning the password hash and the cookie signing key. */
const RECORD_KEY = "dsh-web-login/state";
/** Payload version of that record. */
const RECORD_VERSION = 1;
/** Gate cookie name. Fixed, because the authority is carried inside the signed value. */
const COOKIE_NAME = "dsh_gate";
/** Gate cookie value version tag. */
const COOKIE_VERSION = "v1";
/** Harness's own session cookie prefix; logout expires it best-effort. */
const HARNESS_COOKIE_PREFIX = "dsh-auth-";
/** Route owning the password form. */
const LOGIN_PATH = "/__login";
/** Route clearing the gate cookie. */
const LOGOUT_PATH = "/__logout";
/** Largest accepted form body. */
const MAX_BODY_BYTES = 8192;
/** scrypt cost parameters for new passwords. */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };
/** Bytes of the cookie signing key. */
const SECRET_BYTES = 32;
/** Bytes of the printed first-run setup token. */
const SETUP_TOKEN_BYTES = 24;
/** One day in seconds. */
const DAY_SECONDS = 86400;
/** One hour in seconds. */
const HOUR_SECONDS = 3600;

/** Defaults for every config key; a profile patch overrides individual keys. */
const DEFAULTS = {
	enabled: true,
	title: "DeepSeek Harness",
	passwordMinLength: 8,
	rememberDays: 30,
	sessionHours: 12,
	maxFailures: 5,
	lockoutSeconds: 300,
	clientIpHeader: "x-real-ip",
	allowLoopbackSetup: false,
	indexHtml: ""
};

//#region encoding helpers

/** Encode bytes as unpadded base64url. */
function base64url(value) {
	return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Decode unpadded base64url, rejecting anything that would round-trip differently. */
function fromBase64url(value) {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return undefined;
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const decoded = Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/") + padding, "base64");
	return base64url(decoded) === value ? decoded : undefined;
}

/** HMAC-SHA256 of one cookie body. */
function sign(secret, body) {
	return createHmac("sha256", secret).update(body).digest();
}

/** Serialize a gate cookie value: version, signed body, signature. */
function encodeCookie(payload, secret) {
	const body = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
	return `${COOKIE_VERSION}.${body}.${base64url(sign(secret, body))}`;
}

/**
 * Verify a gate cookie value.
 * @param value - raw cookie value, or undefined when absent.
 * @param secret - this installation's cookie signing key.
 * @param authority - canonical request authority the cookie must be bound to.
 * @returns the decoded payload, or undefined when the value is absent, forged,
 *   expired, or minted for another authority.
 */
function decodeCookie(value, secret, authority) {
	if (typeof value !== "string") return undefined;
	const parts = value.split(".");
	if (parts.length !== 3) return undefined;
	const [version, body, encodedSignature] = parts;
	if (version !== COOKIE_VERSION || body === undefined || encodedSignature === undefined) return undefined;
	const actual = fromBase64url(encodedSignature);
	if (actual === undefined) return undefined;
	const expected = sign(secret, body);
	if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined;
	const raw = fromBase64url(body);
	if (raw === undefined) return undefined;
	let payload;
	try {
		payload = JSON.parse(raw.toString("utf8"));
	} catch {
		return undefined;
	}
	if (typeof payload !== "object" || payload === null) return undefined;
	if (payload.authority !== authority) return undefined;
	if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now()) return undefined;
	return payload;
}

/** Read one cookie value without implementing general Cookie parsing. */
function cookieValue(header, wanted) {
	if (typeof header !== "string") return undefined;
	for (const segment of header.split(";")) {
		const at = segment.indexOf("=");
		if (at === -1 || segment.slice(0, at).trim() !== wanted) continue;
		return segment.slice(at + 1).trim();
	}
	return undefined;
}

/** Canonical authority (`host` or `host:port`) the browser used, or undefined. */
function requestAuthority(headers) {
	const host = headers.host;
	if (typeof host !== "string" || host === "") return undefined;
	try {
		return new URL(`http://${host}`).host;
	} catch {
		return undefined;
	}
}

/** Constant-time comparison of two strings. */
function tokenMatches(actual, expected) {
	const left = Buffer.from(typeof actual === "string" ? actual : "", "utf8");
	const right = Buffer.from(expected, "utf8");
	return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

//#endregion

//#region config

/** Validate one positive-integer config value. */
function positiveInt(raw, fallback, key) {
	if (raw === undefined) return fallback;
	if (!Number.isSafeInteger(raw) || raw < 1) throw new TypeError(`dsh-web-login: config ${key} must be a positive integer`);
	return raw;
}

/** Validate one boolean config value. */
function boolean(raw, fallback, key) {
	if (raw === undefined) return fallback;
	if (typeof raw !== "boolean") throw new TypeError(`dsh-web-login: config ${key} must be a boolean`);
	return raw;
}

/** Validate one string config value. */
function text(raw, fallback, key) {
	if (raw === undefined) return fallback;
	if (typeof raw !== "string") throw new TypeError(`dsh-web-login: config ${key} must be a string`);
	return raw;
}

/** Resolve the raw patch config into validated values, or throw on a typo. */
function readConfig(raw) {
	const source = typeof raw === "object" && raw !== null ? raw : {};
	return {
		enabled: boolean(source.enabled, DEFAULTS.enabled, "enabled"),
		title: text(source.title, DEFAULTS.title, "title"),
		passwordMinLength: positiveInt(source.passwordMinLength, DEFAULTS.passwordMinLength, "passwordMinLength"),
		rememberDays: positiveInt(source.rememberDays, DEFAULTS.rememberDays, "rememberDays"),
		sessionHours: positiveInt(source.sessionHours, DEFAULTS.sessionHours, "sessionHours"),
		maxFailures: positiveInt(source.maxFailures, DEFAULTS.maxFailures, "maxFailures"),
		lockoutSeconds: positiveInt(source.lockoutSeconds, DEFAULTS.lockoutSeconds, "lockoutSeconds"),
		clientIpHeader: text(source.clientIpHeader, DEFAULTS.clientIpHeader, "clientIpHeader").toLowerCase(),
		allowLoopbackSetup: boolean(source.allowLoopbackSetup, DEFAULTS.allowLoopbackSetup, "allowLoopbackSetup"),
		indexHtml: text(source.indexHtml, DEFAULTS.indexHtml, "indexHtml")
	};
}

//#endregion

//#region password storage

/** Whether a loopback literal names this machine rather than a real peer. */
function isLoopbackAddress(value) {
	const address = value.startsWith("::ffff:") ? value.slice(7) : value;
	return address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
}

/**
 * The peer address used for lockout bookkeeping.
 *
 * Behind a reverse proxy every request arrives from the proxy, so the operator
 * declares the header that proxy sets (nginx's `X-Real-IP`, which overwrites
 * any client-supplied value). Trusting it is only sound because Harness binds
 * loopback and therefore only the proxy can reach the port.
 */
function clientAddress(req, config) {
	if (config.clientIpHeader !== "") {
		const raw = req.headers[config.clientIpHeader];
		const value = Array.isArray(raw) ? raw[0] : raw;
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return req.socket?.remoteAddress ?? "unknown";
}

/** Whether the request reached the port from this machine itself. */
function isLoopbackRequest(req, config) {
	return isLoopbackAddress(clientAddress(req, config));
}

/** Derive one scrypt hash. */
async function derive(password, salt, params) {
	return await scrypt(password, salt, params.keylen, {
		N: params.N,
		r: params.r,
		p: params.p,
		maxmem: 256 * 1024 * 1024
	});
}

/** Read and validate the stored gate record. */
async function loadState(ctx) {
	const record = await ctx.credentials.readRecord(RECORD_KEY);
	if (record === undefined) return undefined;
	if (record.kind !== "grant" || typeof record.payload !== "object" || record.payload === null) {
		throw new Error(`credential record ${RECORD_KEY} has an unsupported format`);
	}
	const payload = record.payload;
	if (payload.version !== RECORD_VERSION) {
		throw new Error(`credential record ${RECORD_KEY} has version ${String(payload.version)}, expected ${String(RECORD_VERSION)}`);
	}
	for (const key of ["salt", "hash", "sessionSecret"]) {
		if (fromBase64url(payload[key]) === undefined) throw new Error(`credential record ${RECORD_KEY} has an invalid ${key}`);
	}
	for (const key of ["N", "r", "p", "keylen"]) {
		if (!Number.isSafeInteger(payload[key]) || payload[key] < 1 || payload[key] > 1_048_576) {
			throw new Error(`credential record ${RECORD_KEY} has an invalid scrypt parameter ${key}`);
		}
	}
	return payload;
}

/** Create the record for a freshly chosen password. */
async function createState(password) {
	const salt = randomBytes(16);
	const hash = await derive(password, salt, SCRYPT_PARAMS);
	return {
		version: RECORD_VERSION,
		algorithm: "scrypt",
		...SCRYPT_PARAMS,
		salt: base64url(salt),
		hash: base64url(hash),
		sessionSecret: base64url(randomBytes(SECRET_BYTES)),
		createdAt: new Date().toISOString()
	};
}

/** Check a submitted password against the stored record. */
async function verifyPassword(password, state) {
	const salt = fromBase64url(state.salt);
	const expected = fromBase64url(state.hash);
	if (salt === undefined || expected === undefined) return false;
	const actual = await derive(password, salt, state);
	return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

//#endregion

//#region brute-force tracking

/** Per-address failure counter with a lockout window. */
class FailureTracker {
	constructor(maxFailures, lockoutSeconds) {
		this.maxFailures = maxFailures;
		this.lockoutSeconds = lockoutSeconds;
		this.entries = new Map();
	}

	/** Seconds the caller must wait, or 0 when it may try now. */
	retryAfter(ip) {
		const entry = this.entries.get(ip);
		if (entry === undefined) return 0;
		const remaining = entry.blockedUntil - Date.now();
		return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
	}

	/** Record one failure and return the resulting wait in seconds. */
	fail(ip) {
		const now = Date.now();
		const entry = this.entries.get(ip) ?? { failures: 0, blockedUntil: 0 };
		entry.failures += 1;
		if (entry.failures >= this.maxFailures) entry.blockedUntil = now + this.lockoutSeconds * 1000;
		this.entries.set(ip, entry);
		if (this.entries.size > 1024) {
			for (const [key, value] of this.entries) if (value.blockedUntil <= now && value.failures < this.maxFailures) this.entries.delete(key);
		}
		return this.retryAfter(ip);
	}

	/** Clear one address after a successful check. */
	succeed(ip) {
		this.entries.delete(ip);
	}
}

//#endregion

//#region http helpers

/**
 * Security headers for every gate-owned response. These must never be applied
 * to the rendered application document: the app is a script/style/fetch-heavy
 * SPA, so a `default-src 'none'` policy would blank it out.
 */
const GATE_HEADERS = {
	"cache-control": "no-store",
	"content-security-policy":
		"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
	"referrer-policy": "no-referrer",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY"
};

/** Send a plain-text response. */
function sendText(req, res, status, text, extra) {
	res.writeHead(status, { ...GATE_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra });
	res.end(req.method === "HEAD" ? undefined : `${text}\n`);
}

/** Send an HTML response. */
function sendHtml(req, res, status, html, extra) {
	res.writeHead(status, { ...GATE_HEADERS, "content-type": "text/html; charset=utf-8", ...extra });
	res.end(req.method === "HEAD" ? undefined : html);
}

/**
 * Send the application document. Deliberately header-minimal: it mirrors the
 * shipped static owner exactly (`content-type` only) because the gate's own CSP
 * would otherwise block the application's scripts and styles.
 */
function sendDocument(req, res, html) {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(req.method === "HEAD" ? undefined : html);
}

/** Send a see-other redirect. */
function redirect(res, location, extra) {
	res.writeHead(303, { ...GATE_HEADERS, location, ...extra });
	res.end();
}

/** Read and parse an urlencoded form body, or undefined when unusable. */
async function readForm(req) {
	const contentType = req.headers["content-type"];
	const media = typeof contentType === "string" ? contentType.split(";", 1)[0].trim().toLowerCase() : "";
	if (media !== "application/x-www-form-urlencoded") return undefined;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) return undefined;
		chunks.push(chunk);
	}
	try {
		return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
	} catch {
		return undefined;
	}
}

/**
 * Harness's own session cookie name for one authority. Logout expires it so a
 * dismissed browser cannot keep reaching `/index.html` through Harness's own
 * grant. Best effort: if Harness ever renames the cookie this only stops
 * clearing it, which cannot break the gate.
 */
function harnessCookieName(authority) {
	return HARNESS_COOKIE_PREFIX + base64url(createHash("sha256").update(authority).digest());
}

/** Build the Set-Cookie header pair that discards both sessions. */
function clearCookies(authority) {
	const attrs = "Max-Age=0; Path=/; HttpOnly; SameSite=Strict";
	return [`${COOKIE_NAME}=; ${attrs}`, `${harnessCookieName(authority)}=; ${attrs}`];
}

//#endregion

//#region frontend rendering

/**
 * Resolve the served `index.html` and its renderer.
 *
 * A host route that owns `/index.html` must produce the document itself, with
 * the same index injections the shipped static owner applies. Locating the dist
 * is the fragile part: `dsh plugin add` installs this package as a *symlink*, so
 * `import.meta.url` resolves to wherever the source really lives and the usual
 * upward node_modules walk finds nothing. Resolution therefore tries every base
 * a real installation can present, and the config key overrides them all.
 * @param ctx - plugin context carrying the web server.
 * @param config - resolved config, whose `indexHtml` overrides resolution.
 * @returns the renderer, or undefined when no candidate resolves.
 */
function createIndexRenderer(ctx, config) {
	const specifier = "@deepseek-ai/dsh-web-frontend/package.json";
	const candidates = [];
	if (config.indexHtml !== "") {
		const explicit = resolve(config.indexHtml);
		if (!existsSync(explicit)) throw new Error(`dsh-web-login: config indexHtml ${JSON.stringify(explicit)} does not exist`);
		candidates.push(explicit);
	} else {
		/* The plugin's own location: correct when installed as a real directory. */
		candidates.push(...resolveFrom(import.meta.url, specifier));
		/* The running dsh entry point: correct for a symlinked npm/pnpm install. */
		const entry = process.argv[1];
		if (typeof entry === "string" && entry !== "") {
			try {
				candidates.push(...resolveFrom(realpathSync(entry), specifier));
			} catch {
				/* An unreadable entry point is not a reason to give up on the others. */
			}
		}
		/* The installation-wide module farm every profile already resolves through. */
		candidates.push(join(resolveDshHome(), "profiles", "node_modules", ...specifier.split("/").slice(0, -1), "dist", "index.html"));
	}
	const distIndex = candidates.find((candidate) => existsSync(candidate));
	if (distIndex === undefined) return undefined;
	return async () => {
		const html = await readFile(distIndex, "utf8");
		return ctx.webServer.renderIndex(html).replace(/<head(?:\s[^>]*)?>/iu, (open) => `${open}<base href="/">`);
	};
}

/** Candidate dist paths reachable from one resolution base, or an empty list. */
function resolveFrom(base, specifier) {
	try {
		return [join(dirname(createRequire(base).resolve(specifier)), "dist", "index.html")];
	} catch {
		return [];
	}
}

/**
 * The harness home, by the same rule the CLI uses: a non-blank `$DSH_HOME`,
 * otherwise `~/.dsh`.
 */
function resolveDshHome() {
	const fromEnv = process.env.DSH_HOME;
	const configured = typeof fromEnv === "string" && fromEnv.trim() !== "" ? fromEnv.trim() : undefined;
	if (configured === undefined) return join(homedir(), ".dsh");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/") || configured.startsWith("~\\")) return resolve(join(homedir(), configured.slice(2)));
	return resolve(configured);
}

//#endregion

/**
 * Mount the gate: resolve config, claim the document routes, and print the
 * first-run setup token when this installation has no password yet.
 * @param ctx - owning Cordis context.
 * @param config - raw patch config from the profile layer.
 */
export function apply(ctx, config) {
	const resolved = readConfig(config);
	if (!resolved.enabled) {
		ctx.logger.info("dsh-web-login: disabled by config");
		return;
	}

	const failures = new FailureTracker(resolved.maxFailures, resolved.lockoutSeconds);
	const setupToken = base64url(randomBytes(SETUP_TOKEN_BYTES));
	const renderIndex = createIndexRenderer(ctx, resolved);

	let state;
	let loadError;
	const stateReady = loadState(ctx).then(
		(loaded) => {
			state = loaded;
		},
		(error) => {
			loadError = error instanceof Error ? error : new Error(String(error));
		}
	);

	/** The login page, or the first-run setup page while no password exists. */
	function servePrompt(req, res, status, error) {
		const body =
			state === undefined
				? setupPage({
						title: resolved.title,
						error,
						minLength: resolved.passwordMinLength,
						needsToken: !(resolved.allowLoopbackSetup && isLoopbackRequest(req, resolved))
					})
				: loginPage({ title: resolved.title, error });
		sendHtml(req, res, status, body);
	}

	/**
	 * Path-and-query form of the launch-token URL, for a redirect the browser
	 * resolves against the origin it is already on.
	 *
	 * Never redirect to the absolute URL `authenticatedUrl` builds: a reverse
	 * proxy may rewrite `Host` to the loopback upstream (a documented way to
	 * satisfy Harness's trust fence), and an absolute redirect would then send
	 * the visitor to port 3080 on their own machine.
	 */
	function tokenRedirectPath() {
		const url = new URL(ctx.connection.authenticatedUrl("http://dsh.invalid"));
		return `${url.pathname}${url.search}`;
	}

	/** Mint the gate cookie and hand the browser to Harness's own token exchange. */
	function grant(req, res, authority, remember) {
		const lifetime = remember ? resolved.rememberDays * DAY_SECONDS : resolved.sessionHours * HOUR_SECONDS;
		const expiresAt = Date.now() + lifetime * 1000;
		const value = encodeCookie({ authority, expiresAt }, state.sessionSecret);
		redirect(res, tokenRedirectPath(), {
			"set-cookie": `${COOKIE_NAME}=${value}; Max-Age=${lifetime}; Path=/; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`
		});
	}

	/**
	 * Own `/` and `/index.html`. The gate decision is the same for both; a
	 * request that has not passed it never reaches Harness's document handler,
	 * so the printed launch token cannot be spent without the password.
	 */
	async function handleDocument(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			sendText(req, res, 405, "method not allowed", { allow: "GET, HEAD" });
			return;
		}
		const authority = requestAuthority(req.headers);
		if (authority === undefined) {
			sendText(req, res, 400, "bad request");
			return;
		}
		await stateReady;
		if (loadError !== undefined) {
			sendText(req, res, 503, `login gate unavailable: ${loadError.message}`);
			return;
		}
		const url = new URL(req.url ?? "/", "http://dsh.invalid");
		const isRoot = url.pathname === "/";
		const gated = state !== undefined && decodeCookie(cookieValue(req.headers.cookie, COOKIE_NAME), state.sessionSecret, authority) !== undefined;
		if (!gated) {
			servePrompt(req, res, 200, undefined);
			return;
		}
		if (isRoot && url.searchParams.has("token")) {
			ctx.connection.authorizeIndex(req, res);
			return;
		}
		const rejection = ctx.connection.requestRejection(req);
		if (rejection === 401) {
			redirect(res, tokenRedirectPath());
			return;
		}
		if (rejection === 403) {
			sendHtml(
				req,
				res,
				403,
				messagePage({
					title: resolved.title,
					heading: "请求被 Harness 拒绝",
					body: "Host 或 Origin 不在信任范围内。",
					detail: "请直接用地址栏里的域名或 IP 访问，并确认启动参数 --trusted-host 与之一致。"
				})
			);
			return;
		}
		if (renderIndex === undefined) {
			redirect(res, "/index.html");
			return;
		}
		let document;
		try {
			document = await renderIndex();
		} catch (error) {
			sendHtml(
				req,
				res,
				503,
				messagePage({
					title: resolved.title,
					heading: "前端资源不可用",
					body: "无法读取前端 index.html。",
					detail: error instanceof Error ? error.message : String(error)
				})
			);
			return;
		}
		sendDocument(req, res, document);
	}

	/** Serve or process the password form. */
	async function handleLogin(req, res) {
		const authority = requestAuthority(req.headers);
		if (authority === undefined) {
			sendText(req, res, 400, "bad request");
			return;
		}
		await stateReady;
		if (loadError !== undefined) {
			sendText(req, res, 503, `login gate unavailable: ${loadError.message}`);
			return;
		}
		if (req.method === "GET" || req.method === "HEAD") {
			const gated = state !== undefined && decodeCookie(cookieValue(req.headers.cookie, COOKIE_NAME), state.sessionSecret, authority) !== undefined;
			if (gated) redirect(res, "/");
			else servePrompt(req, res, 200, undefined);
			return;
		}
		if (req.method !== "POST") {
			sendText(req, res, 405, "method not allowed", { allow: "GET, HEAD, POST" });
			return;
		}

		const address = clientAddress(req, resolved);
		const waiting = failures.retryAfter(address);
		if (waiting > 0) {
			sendHtml(
				req,
				res,
				429,
				messagePage({
					title: resolved.title,
					heading: "尝试过于频繁",
					body: `请在 ${String(waiting)} 秒后重试。`
				}),
				{ "retry-after": String(waiting) }
			);
			return;
		}

		const form = await readForm(req);
		if (form === undefined) {
			sendText(req, res, 400, "bad request");
			return;
		}

		/* First run: create the password instead of checking one. */
		if (state === undefined) {
			const loopback = resolved.allowLoopbackSetup && isLoopbackRequest(req, resolved);
			if (!loopback && !tokenMatches(form.get("setup"), setupToken)) {
				const wait = failures.fail(address);
				servePrompt(req, res, wait > 0 ? 429 : 403, "初始化口令不正确。");
				return;
			}
			const password = form.get("password") ?? "";
			const confirm = form.get("confirm") ?? "";
			if (password.length < resolved.passwordMinLength) {
				servePrompt(req, res, 400, `密码至少需要 ${String(resolved.passwordMinLength)} 位。`);
				return;
			}
			if (password !== confirm) {
				servePrompt(req, res, 400, "两次输入的密码不一致。");
				return;
			}
			const created = await createState(password);
			await ctx.credentials.modifyRecord(RECORD_KEY, async () => ({ kind: "grant", payload: created }));
			state = created;
			failures.succeed(address);
			process.stdout.write("dsh web-login: 密码已设置，初始化口令即刻失效\n");
			grant(req, res, authority, true);
			return;
		}

		const password = form.get("password") ?? "";
		if (!(await verifyPassword(password, state))) {
			const wait = failures.fail(address);
			servePrompt(req, res, wait > 0 ? 429 : 401, wait > 0 ? `尝试过于频繁，请在 ${String(wait)} 秒后重试。` : "密码不正确。");
			return;
		}
		failures.succeed(address);
		grant(req, res, authority, form.get("remember") === "1");
	}

	/** Drop both browser sessions. */
	async function handleLogout(req, res) {
		if (req.method !== "GET" && req.method !== "POST") {
			sendText(req, res, 405, "method not allowed", { allow: "GET, POST" });
			return;
		}
		const authority = requestAuthority(req.headers);
		redirect(res, "/", authority === undefined ? {} : { "set-cookie": clearCookies(authority) });
	}

	ctx.effect(
		() => ctx.webServer.register({ kind: "exact", path: "/", handler: handleDocument }),
		"dsh-web-login: document route /"
	);
	if (renderIndex !== undefined) {
		ctx.effect(
			() => ctx.webServer.register({ kind: "exact", path: "/index.html", handler: handleDocument }),
			"dsh-web-login: document route /index.html"
		);
	}
	ctx.effect(
		() => ctx.webServer.register({ kind: "exact", path: LOGIN_PATH, handler: handleLogin }),
		"dsh-web-login: login route"
	);
	ctx.effect(
		() => ctx.webServer.register({ kind: "exact", path: LOGOUT_PATH, handler: handleLogout }),
		"dsh-web-login: logout route"
	);

	void stateReady.then(() => {
		if (loadError !== undefined) {
			process.stdout.write(`dsh web-login: 无法读取密码记录：${loadError.message}\n`);
			return;
		}
		if (state === undefined) {
			process.stdout.write(
				`dsh web-login: 尚未设置密码，首次打开页面时填写下面的初始化口令\n` +
					`dsh web-login: setup-token: ${setupToken}\n`
			);
			return;
		}
		process.stdout.write(
			`dsh web-login: 已启用密码保护（登录页 ${LOGIN_PATH}，退出 ${LOGOUT_PATH}）\n`
		);
		if (renderIndex === undefined) {
			process.stdout.write(
				`dsh web-login: 警告：未能定位前端 index.html，/index.html 未纳入密码保护（/ 仍然受保护）\n` +
					`dsh web-login: 如需修复，在 profile 的 cordis.patch.yml 里给 web-login 行设置 indexHtml 为前端 index.html 的绝对路径\n`
			);
		}
	});
}
