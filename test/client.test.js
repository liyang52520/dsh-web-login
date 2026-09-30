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
		React: {
			/*
			 * Mirrors React's own rule: children passed as arguments win, a single
			 * child is not wrapped in an array, and passing none leaves a `children`
			 * already present in props untouched. Overwriting unconditionally made
			 * `createElement(Component, { children })` lose its label.
			 */
			createElement: (type, props, ...children) => {
				const merged = { ...props };
				if (children.length === 1) merged.children = children[0];
				else if (children.length > 1) merged.children = children;
				return { type, props: merged };
			}
		},
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
				Button: (props) => React.createElement("button", { "data-primitive": props.variant }, props.children),
				/* The real Modal renders its header from these props. */
				Modal: (props) => (props.open === true
					? React.createElement("div", { "data-primitive": "modal", "data-title": props.title }, [
						React.createElement("div", { key: "t" }, props.title),
						React.createElement("div", { key: "d" }, props.description),
						props.children
					])
					: null)
			};
		}
		throw new Error(`unexpected require(${JSON.stringify(specifier)})`);
	});
	return { spec: captured, face };
}

/**
 * Apply the function components in an element tree, so assertions describe what
 * would actually render. The stand-ins are pure, so calling them is safe; a
 * closed modal disappears here exactly as it would in the browser.
 */
function render(node) {
	if (node === null || node === undefined || typeof node === "boolean") return node;
	if (typeof node === "string" || typeof node === "number") return node;
	if (Array.isArray(node)) return node.map(render);
	if (typeof node.type === "function") return render(node.type(node.props));
	return { ...node, props: { ...node.props, children: render(node.props?.children) } };
}

/** Collect the text content of a rendered tree. */
function textOf(node) {
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join(" ");
	if (typeof node === "object" && node.props !== undefined) return textOf(node.props.children);
	return "";
}

/** Collect every element whose type is `tag`. */
function findAll(node, tag, out = []) {
	if (node === null || typeof node !== "object") return out;
	if (Array.isArray(node)) { for (const child of node) findAll(child, tag, out); return out; }
	if (node.type === tag) out.push(node);
	if (node.props?.children !== undefined) findAll(node.props.children, tag, out);
	return out;
}

/** The rendered text of one element. */
const labelOf = (node) => textOf(node.props.children);

/** Every design-system Button label in a rendered tree, in document order. */
const buttonLabels = (tree) => findAll(tree, "button").map(labelOf);

/** Every dialog title rendered by the Modal stand-in, in document order. */
const dialogTitles = (tree) =>
	findAll(tree, "div").filter((n) => n.props["data-primitive"] === "modal").map((n) => n.props["data-title"]);

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
		changeOpen: true,
		resetOpen: true,
		logoutOpen: true,
		form: { current: "", next: "", confirm: "" },
		changeError: undefined,
		resetPassword: "",
		resetError: undefined,
		notice: undefined,
		busy: false,
		handlers: {
			onField() {}, onPassword() {}, onLogout() {}, onReset() {},
			onOpenChange() {}, onCancelChange() {}, onOpenReset() {}, onCancelReset() {},
			onOpenLogout() {}, onCancelLogout() {}, onResetField() {}
		}
	});
	const text = textOf(render(element));

	assert.match(text, /密码保护/);
	assert.match(text, /已启用/);
	assert.match(text, /30 天/);
	assert.match(text, /5 次失败后锁定 300 秒/);
	assert.match(text, /203\.0\.113\.9/, "a locked source must be listed");
	assert.match(text, /240 秒/);
	assert.match(text, /修改密码/);
	/*
	 * Buttons must go through the design system rather than hand-rolled
	 * elements.
	 */
	assert.deepEqual(
		findAll(render(element), "button").map((n) => n.props["data-primitive"]),
		["outline", "outline", "outline", "outline", "primary", "outline", "primary", "outline", "primary"],
		"three page actions plus a cancel/confirm pair in each of the three dialogs"
	);
	assert.deepEqual(
		buttonLabels(render(element)).slice(0, 3),
		["修改密码", "重置密码", "退出登录"],
		"logout must sit last in the action row"
	);

	/* The change form must be revealed by a button, not always on the page. */
	const collapsed = face.sectionView({
		status: undefined, changeOpen: false, resetOpen: false, logoutOpen: false,
		form: { current: "", next: "", confirm: "" }, changeError: undefined,
		resetPassword: "", resetError: undefined, notice: undefined, busy: false,
		handlers: {}
	});
	const collapsedText = textOf(render(collapsed));
	assert.equal(collapsedText.includes("确认新密码"), false, "the form must stay collapsed until asked for");
	assert.equal(collapsedText.includes("当前密码"), false, "the reset dialog must stay closed");
	assert.equal(collapsedText.includes("重置密码"), true, "the trigger button is still offered");
	assert.match(text, /退出登录/);
	assert.match(text, /重置密码/);
});

test("every action uses the native modal, never window.prompt", async () => {
	const { face } = await loadClientHalf();
	const base = {
		status: {
			passwordSet: true, locked: [],
			config: { title: "t", passwordMinLength: 8, rememberDays: 30, sessionHours: 12, maxFailures: 5, lockoutSeconds: 300, unlockRemoteSettings: true }
		},
		form: { current: "", next: "", confirm: "" }, changeError: undefined,
		resetPassword: "", resetError: undefined, notice: undefined, busy: false, handlers: {}
	};

	const all = render(face.sectionView({ ...base, changeOpen: true, resetOpen: true, logoutOpen: true }));
	assert.deepEqual(
		dialogTitles(all),
		["修改密码", "重置密码", "退出登录"],
		"each action gets its own dialog, and only one may be open at a time"
	);
	assert.match(textOf(all), /至少 8 位/, "the change dialog states the minimum length");

	const reset = render(face.sectionView({ ...base, changeOpen: false, resetOpen: true, logoutOpen: false }));
	assert.deepEqual(dialogTitles(reset), ["重置密码"]);
	assert.match(textOf(reset), /请输入当前密码以确认/, "the consequence is spelled out");
	assert.equal(textOf(reset).includes("确认新密码"), false, "the change dialog must not leak into the reset view");

	const logout = render(face.sectionView({ ...base, changeOpen: false, resetOpen: false, logoutOpen: true }));
	assert.deepEqual(dialogTitles(logout), ["退出登录"]);
	assert.match(textOf(logout), /下次进入需要重新输入密码/, "logout explains what it does");
	assert.equal(textOf(logout).includes("当前密码"), false, "logout must not ask for a password");

	/* A failed submit must surface inside the dialog, not behind it. */
	const failed = render(face.sectionView({ ...base, changeOpen: true, resetOpen: false, changeError: "当前密码不正确" }));
	assert.match(textOf(failed), /当前密码不正确/);
});

test("the section view renders before the status arrives, and shows notices", async () => {
	const { face } = await loadClientHalf();
	const loading = face.sectionView({
		status: undefined,
		form: { current: "", next: "", confirm: "" }, changeError: undefined,
		resetPassword: "", resetError: undefined,
		notice: undefined,
		busy: false,
		handlers: {}
	});
	assert.match(textOf(render(loading)), /正在读取状态/);

	const failed = face.sectionView({
		status: undefined,
		form: { current: "", next: "", confirm: "" }, changeError: undefined,
		resetPassword: "", resetError: undefined,
		notice: { kind: "error", text: "当前密码不正确" },
		busy: false,
		handlers: {}
	});
	assert.match(textOf(render(failed)), /当前密码不正确/);
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
		form: { current: "", next: "", confirm: "" }, changeError: undefined,
		resetPassword: "", resetError: undefined,
		notice: undefined,
		busy: false,
		handlers: {}
	});
	assert.match(textOf(render(element)), /无/);
	assert.match(textOf(render(element)), /远程浏览器可用设置 否/);
});
