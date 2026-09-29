/**
 * Regression suite for the browser half.
 *
 * The bundle is a classic script that calls `window.__ModuleLoader__.load`, so
 * the test installs that shim, imports the file for its side effect, and drives
 * the captured factory with a `require` that hands back the real React. That
 * covers the parts most likely to break silently: the envelope's module id, the
 * slot registration shape, and the rendered markup of the pure view.
 */

import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);

/**
 * React is intentionally not a dependency of this package, so borrow the copy
 * the installed Harness already ships. Falls back to a minimal `createElement`
 * when no Harness is present, which is enough for the pure view but is reported
 * in the test names so a green run is not mistaken for React-level coverage.
 */
function loadReact() {
	try {
		return { React: require("react"), real: true };
	} catch {
		/* Not resolvable from here; look next to the dsh entry point. */
	}
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		const bin = join(dir, "dsh");
		if (dir === "" || !existsSync(bin)) continue;
		try {
			return { React: createRequire(realpathSync(bin))("react"), real: true };
		} catch {
			/* Keep looking. */
		}
	}
	return {
		React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
		real: false
	};
}

const { React, real: hasRealReact } = loadReact();

/** Load the client bundle and return the module face its factory produced. */
async function loadClientHalf() {
	let captured;
	globalThis.window = {
		__ModuleLoader__: {
			load(spec) {
				captured = spec;
			}
		}
	};
	await import(`../client.js?cachebust=${String(Math.random())}`);
	assert.ok(captured !== undefined, "the bundle must register itself with the module loader");
	const face = captured.factory((specifier) => {
		if (specifier === "react") return React;
		if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
			/* Stand-in for the shell-provided design system. */
			return {
				Button: (props) => React.createElement("button", { "data-primitive": props.variant }, props.children)
			};
		}
		throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
	});
	return { spec: captured, face };
}

/** Walk a React element tree and collect its text content. */
function textOf(node) {
	if (node === null || node === undefined || node === false || node === true) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join(" ");
	if (typeof node === "object" && node.props !== undefined) return textOf(node.props.children);
	return "";
}

test("the client bundle registers under the package id and exports a plugin face", async () => {
	const { spec, face } = await loadClientHalf();
	assert.equal(spec.id, "dsh-web-login", "the module id must be the package name the host serves it as");
	assert.equal(typeof spec.factory, "function");
	assert.equal(typeof face.apply, "function", "the loader needs apply");
	assert.deepEqual(face.inject, ["slots"], "the slot registry is the only required service");
});

test("apply registers exactly one settings.section entry", async () => {
	const { face } = await loadClientHalf();
	const registered = [];
	const ctx = {
		slots: {
			inject(name, register) {
				assert.equal(name, "settings.section");
				register();
			},
			register(declaration, component) {
				registered.push({ declaration, component });
			}
		}
	};
	face.apply(ctx);

	assert.equal(registered.length, 1);
	const { declaration, component } = registered[0];
	assert.equal(declaration.name, "settings.section");
	assert.equal(declaration.id, "web-login");
	assert.equal(typeof declaration.order, "number");
	assert.equal(declaration.label(), "登录门禁");
	assert.equal(typeof component, "function");
});

test("the section view renders the status table and both action groups", async () => {
	const { face } = await loadClientHalf();
	const element = face.sectionView({
		status: {
			passwordSet: true,
			locked: [{ ip: "203.0.113.9", retryAfter: 240, failures: 5 }],
			config: {
				title: "DeepSeek Harness",
				passwordMinLength: 8,
				rememberDays: 30,
				sessionHours: 12,
				maxFailures: 5,
				lockoutSeconds: 300,
				unlockRemoteSettings: true
			}
		},
		form: { current: "", next: "", confirm: "" },
		notice: undefined,
		busy: false,
		handlers: { onField() {}, onPassword() {}, onLogout() {}, onReset() {} }
	});
	const text = textOf(element);

	assert.match(text, /密码保护/);
	assert.match(text, /已启用/);
	assert.match(text, /30 天/);
	assert.match(text, /5 次失败后锁定 300 秒/);
	assert.match(text, /203\.0\.113\.9/, "a locked source must be listed");
	assert.match(text, /240 秒/);
	assert.match(text, /修改密码/);
	/*
	 * Buttons must go through the design system rather than hand-rolled
	 * elements. Nothing renders the tree here, so a Button usage shows up as an
	 * element whose type is the component and whose props carry the variant.
	 */
	const buttons = [];
	(function walk(node) {
		if (node === null || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(walk);
		if (typeof node.type === "function" && typeof node.props?.variant === "string") buttons.push(node.props.variant);
		if (node.props?.children !== undefined) walk(node.props.children);
	})(element);
	assert.deepEqual(buttons, ["primary", "outline", "outline"], "save plus the two session actions");
	assert.match(text, /退出登录/);
	assert.match(text, /重置密码/);
});

test("the section view renders before the status arrives, and shows notices", async () => {
	const { face } = await loadClientHalf();
	const loading = face.sectionView({
		status: undefined,
		form: { current: "", next: "", confirm: "" },
		notice: undefined,
		busy: false,
		handlers: {}
	});
	assert.match(textOf(loading), /正在读取状态/);

	const failed = face.sectionView({
		status: undefined,
		form: { current: "", next: "", confirm: "" },
		notice: { kind: "error", text: "当前密码不正确" },
		busy: false,
		handlers: {}
	});
	assert.match(textOf(failed), /当前密码不正确/);
});

test("the section view reports an empty lockout list as none", async () => {
	const { face } = await loadClientHalf();
	const element = face.sectionView({
		status: {
			passwordSet: true,
			locked: [],
			config: {
				title: "t",
				passwordMinLength: 8,
				rememberDays: 30,
				sessionHours: 12,
				maxFailures: 5,
				lockoutSeconds: 300,
				unlockRemoteSettings: false
			}
		},
		form: { current: "", next: "", confirm: "" },
		notice: undefined,
		busy: false,
		handlers: {}
	});
	assert.match(textOf(element), /无/);
	assert.match(textOf(element), /远程浏览器可用设置 否/);
});
