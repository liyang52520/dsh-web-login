/**
 * Regression suite for the parts of the gate that are pure logic: encoding, the
 * signed cookie, password hashing, the failure tracker, and config validation.
 *
 * Deliberately dependency-free, so `node --test` is the whole harness. The HTTP
 * surface is not covered here because it needs a Harness context; those paths
 * were verified against a live instance instead.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { internals } from "../index.js";
import { accountPage, fencePage, loginPage, messagePage, setupPage } from "../page.js";

const {
	ACCOUNT_PATH,
	COOKIE_NAME,
	DEFAULTS,
	FailureTracker,
	TRANSPORT_HOOK_SCRIPT,
	base64url,
	clearCookies,
	createState,
	decodeCookie,
	encodeCookie,
	fromBase64url,
	harnessCookieName,
	readConfig,
	requestAuthority,
	tokenMatches,
	verifyPassword
} = internals;

const SECRET_A = base64url(Buffer.alloc(32, 7));
const SECRET_B = base64url(Buffer.alloc(32, 9));
const AUTHORITY = "harness.example:8443";

/** A cookie payload that is valid for `AUTHORITY` for the next minute. */
const liveCookie = (secret = SECRET_A, authority = AUTHORITY, ttlMs = 60_000) =>
	encodeCookie({ authority, expiresAt: Date.now() + ttlMs }, secret);

test("base64url round-trips bytes and rejects malformed input", () => {
	const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
	assert.deepEqual(fromBase64url(base64url(bytes)), bytes);
	assert.equal(base64url(bytes).includes("="), false, "must be unpadded");
	assert.equal(fromBase64url("a+b"), undefined, "standard base64 alphabet is not accepted");
	assert.equal(fromBase64url("aaaaa"), undefined, "length % 4 === 1 cannot decode");
	assert.equal(fromBase64url(undefined), undefined);
});

test("a freshly minted cookie verifies for its own authority", () => {
	const payload = decodeCookie(liveCookie(), SECRET_A, AUTHORITY);
	assert.equal(payload?.authority, AUTHORITY);
	assert.ok(payload.expiresAt > Date.now());
});

test("cookie verification rejects a wrong secret, a wrong authority and tampering", () => {
	assert.equal(decodeCookie(liveCookie(), SECRET_B, AUTHORITY), undefined, "another secret must not verify");
	assert.equal(decodeCookie(liveCookie(), SECRET_A, "other.example"), undefined, "authority is bound into the cookie");
	assert.equal(decodeCookie(liveCookie(), SECRET_A, "harness.example"), undefined, "a port difference changes the authority");

	const value = liveCookie();
	const [version, body, signature] = value.split(".");
	/*
	 * The realistic forgery is a lifetime extension: take a valid cookie and
	 * re-state a later expiry under the signature you already hold. The body
	 * must therefore differ from the original, or this proves nothing.
	 */
	const extended = base64url(
		Buffer.from(JSON.stringify({ authority: AUTHORITY, expiresAt: Date.now() + 86_400_000 }), "utf8")
	);
	assert.notEqual(extended, body, "the forged body must actually differ");
	assert.equal(decodeCookie(`${version}.${extended}.${signature}`, SECRET_A, AUTHORITY), undefined, "body swap must fail");
	assert.equal(decodeCookie(`${version}.${body}.${base64url(Buffer.alloc(32))}`, SECRET_A, AUTHORITY), undefined, "signature swap must fail");
	assert.equal(decodeCookie(`${version}.${body}`, SECRET_A, AUTHORITY), undefined, "truncated value");
	assert.equal(decodeCookie("v2." + body + "." + signature, SECRET_A, AUTHORITY), undefined, "unknown version");
	assert.equal(decodeCookie(undefined, SECRET_A, AUTHORITY), undefined);
});

test("an expired cookie stops verifying", () => {
	const expired = encodeCookie({ authority: AUTHORITY, expiresAt: Date.now() - 1 }, SECRET_A);
	assert.equal(decodeCookie(expired, SECRET_A, AUTHORITY), undefined);
});

test("passwords hash with a per-record salt and verify only against themselves", async () => {
	const first = await createState("correct horse battery staple");
	const second = await createState("correct horse battery staple");

	assert.notEqual(first.salt, second.salt, "each record must draw a fresh salt");
	assert.notEqual(first.hash, second.hash, "same password must not produce the same hash");
	assert.notEqual(first.sessionSecret, second.sessionSecret, "each record must draw a fresh signing key");
	assert.equal(fromBase64url(first.sessionSecret).byteLength, 32);

	assert.equal(await verifyPassword("correct horse battery staple", first), true);
	assert.equal(await verifyPassword("correct horse battery stapl", first), false);
	assert.equal(await verifyPassword("", first), false);
	assert.deepEqual(
		{ N: first.N, r: first.r, p: first.p, keylen: first.keylen },
		{ N: 16384, r: 8, p: 1, keylen: 32 }
	);
});

test("verifyPassword refuses a record whose stored fields are not decodable", async () => {
	const broken = { ...(await createState("whatever")), hash: "not base64url!" };
	assert.equal(await verifyPassword("whatever", broken), false);
});

test("the failure tracker counts attempts, then locks and clears", () => {
	const failures = new FailureTracker(3, 60);
	const ip = "203.0.113.9";

	assert.deepEqual(failures.fail(ip), { failures: 1, retryAfter: 0, locking: false });
	assert.deepEqual(failures.fail(ip), { failures: 2, retryAfter: 0, locking: false });

	const third = failures.fail(ip);
	assert.equal(third.failures, 3);
	assert.equal(third.locking, true, "the crossing failure reports the new lockout");
	assert.ok(third.retryAfter > 0 && third.retryAfter <= 60, `retryAfter out of range: ${third.retryAfter}`);

	const fourth = failures.fail(ip);
	assert.equal(fourth.locking, false, "an already-locked address does not re-announce");
	assert.ok(failures.retryAfter(ip) > 0);

	failures.succeed(ip);
	assert.equal(failures.retryAfter(ip), 0, "a success clears the record");
	assert.deepEqual(failures.fail(ip), { failures: 1, retryAfter: 0, locking: false });
});

test("lockouts are tracked per address", () => {
	const failures = new FailureTracker(1, 30);
	failures.fail("198.51.100.1");
	assert.ok(failures.retryAfter("198.51.100.1") > 0);
	assert.equal(failures.retryAfter("198.51.100.2"), 0, "one locked address must not lock another");
});

test("requestAuthority normalizes the header the way Harness does", () => {
	assert.equal(requestAuthority({ host: "harness.example" }), "harness.example");
	assert.equal(requestAuthority({ host: "HARNESS.example" }), "harness.example");
	assert.equal(requestAuthority({ host: "harness.example:8443" }), "harness.example:8443");
	assert.equal(requestAuthority({ host: "harness.example:80" }), "harness.example", "a default port is dropped");
	assert.equal(requestAuthority({ host: "127.0.0.1:3080" }), "127.0.0.1:3080");
	assert.equal(requestAuthority({}), undefined);
	assert.equal(requestAuthority({ host: "" }), undefined);
});

test("tokenMatches compares whole strings", () => {
	assert.equal(tokenMatches("abc", "abc"), true);
	assert.equal(tokenMatches("abc", "abd"), false);
	assert.equal(tokenMatches("abc", "abcd"), false, "a prefix must not match");
	assert.equal(tokenMatches(undefined, "abc"), false);
	assert.equal(tokenMatches("", ""), true);
});

test("harnessCookieName mirrors Harness's own session cookie naming", () => {
	const name = harnessCookieName(AUTHORITY);
	assert.ok(name.startsWith("dsh-auth-"), name);
	assert.equal(name, harnessCookieName(AUTHORITY), "deterministic");
	assert.notEqual(name, harnessCookieName("harness.example"), "authority-sensitive");
});

test("logout expires both this gate's cookie and Harness's", () => {
	const cleared = clearCookies(AUTHORITY);
	assert.equal(cleared.length, 2);
	assert.ok(cleared.some((c) => c.startsWith(`${COOKIE_NAME}=;`)), "gate cookie cleared");
	assert.ok(cleared.some((c) => c.startsWith(`${harnessCookieName(AUTHORITY)}=;`)), "Harness cookie cleared");
	for (const cookie of cleared) assert.ok(cookie.includes("Max-Age=0"), cookie);
});

test("readConfig applies defaults", () => {
	const resolved = readConfig(undefined);
	assert.equal(resolved.enabled, DEFAULTS.enabled);
	assert.equal(resolved.rememberDays, 30);
	assert.equal(resolved.sessionHours, 12);
	assert.equal(resolved.unlockRemoteSettings, true);
	assert.equal(resolved.clientIpHeader, "x-real-ip");
	assert.equal(resolved.indexHtml, "");
});

test("readConfig rejects a typo instead of silently ignoring it", () => {
	assert.throws(() => readConfig({ passwordMinLength: 0 }), /positive integer/);
	assert.throws(() => readConfig({ passwordMinLength: 1.5 }), /positive integer/);
	assert.throws(() => readConfig({ rememberDays: "30" }), /positive integer/);
	assert.throws(() => readConfig({ enabled: "yes" }), /must be a boolean/);
	assert.throws(() => readConfig({ unlockRemoteSettings: 1 }), /must be a boolean/);
	assert.throws(() => readConfig({ title: 42 }), /must be a string/);
});

test("readConfig normalizes the client-IP header name and honours overrides", () => {
	assert.equal(readConfig({ clientIpHeader: "X-Real-IP" }).clientIpHeader, "x-real-ip");
	assert.equal(readConfig({ clientIpHeader: "" }).clientIpHeader, "");
	assert.equal(readConfig({ rememberDays: 90 }).rememberDays, 90);
	assert.equal(readConfig({ unlockRemoteSettings: false }).unlockRemoteSettings, false);
});

test("the transport hook only declares ownsHost and adds no other capability", () => {
	assert.match(TRANSPORT_HOOK_SCRIPT, /__DSH_TRANSPORT__/);
	assert.match(TRANSPORT_HOOK_SCRIPT, /ownsHost = true/);
	assert.equal(TRANSPORT_HOOK_SCRIPT.includes("</script"), false, "must not be able to break out of its tag");
});

test("readConfig accepts only the three known page themes", () => {
	assert.equal(readConfig(undefined).pageTheme, "auto");
	assert.equal(readConfig({ pageTheme: "auto" }).pageTheme, "auto");
	assert.equal(readConfig({ pageTheme: "dark" }).pageTheme, "dark");
	assert.equal(readConfig({ pageTheme: "light" }).pageTheme, "light");
	assert.throws(() => readConfig({ pageTheme: "blue" }), /pageTheme/);
	assert.throws(() => readConfig({ pageTheme: true }), /pageTheme/);
});

test("the gate pages carry Harness's own palette and font stack", () => {
	for (const html of [
		loginPage({ title: "T" }),
		setupPage({ title: "T", minLength: 8, needsToken: true }),
		accountPage({ title: "T", minLength: 8 }),
		messagePage({ title: "T", heading: "H", body: "B" }),
		fencePage({ title: "T", host: "h", hint: "x" })
	]) {
		assert.match(html, /--brand: #0f1115/, "light accent must be Harness's near-black brand, not a blue");
		assert.match(html, /--brand: #f9fafb/, "dark accent must be Harness's near-white brand");
		assert.match(html, /-apple-system, BlinkMacSystemFont/, "font stack must match the app");
		assert.equal(html.includes("#2f6bf3"), false, "the old ad-hoc blue must be gone");
		assert.equal(html.includes("<script"), false, "gate pages must stay script-free");
	}
});

test("the theme override is reflected in the document and defaults to the OS", () => {
	/* `data-theme` also appears in the stylesheet selectors, so assert on the tag. */
	assert.match(loginPage({ title: "T" }), /<html lang="zh-CN">/, "auto follows prefers-color-scheme");
	assert.match(loginPage({ title: "T", theme: "auto" }), /<html lang="zh-CN">/);
	assert.match(loginPage({ title: "T", theme: "dark" }), /<html lang="zh-CN" data-theme="dark">/);
	assert.match(loginPage({ title: "T", theme: "light" }), /<html lang="zh-CN" data-theme="light">/);
});

test("page text is escaped", () => {
	const html = loginPage({ title: '<img src=x onerror=alert(1)>', error: "<b>boom</b>" });
	assert.equal(html.includes("<img src=x"), false);
	assert.equal(html.includes("<b>boom</b>"), false);
	assert.match(html, /&lt;img src=x/);
});

test("the change-password route is distinct from the login and the document routes", () => {
	assert.equal(ACCOUNT_PATH, "/__account");
	assert.notEqual(ACCOUNT_PATH, "/");
	assert.notEqual(ACCOUNT_PATH, "/__login");
});
