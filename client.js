/**
 * Browser half of dsh-web-login: one page inside the settings panel.
 *
 * Hand-written against the module-system envelope every Client bundle uses
 * (`window.__ModuleLoader__.load({ id, factory })`), so the package needs no
 * bundler. It contributes a single `settings.section` entry and talks to the
 * host half over the `/__api/*` JSON surface rather than through Cordis RPC,
 * which keeps the two halves independent.
 *
 * `sectionView` is deliberately pure: the React component below it only owns
 * state and effects, so the rendered markup can be unit-tested without a DOM.
 */

window.__ModuleLoader__.load({
	id: "dsh-web-login",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		/*
		 * The design-system Button, so buttons match the panel exactly rather than
		 * approximating it. It is served by the shell's module table; if a future
		 * Harness stops providing it, fall back to a plain styled button instead of
		 * losing the whole page.
		 */
		let Button;
		try {
			Button = require("@deepseek-ai/dsh-client-ui-primitives").Button;
		} catch {
			Button = undefined;
		}

		/**
		 * Every value here was read out of a live Harness settings panel with
		 * getComputedStyle, not guessed: inputs are 32px/radius 8/border 16% and
		 * grouped cards are a borderless #f5f6f7 surface at radius 12 with 14px
		 * 16px padding. Tokens come first so the panel follows the active theme.
		 */
		const T = {
			labelPrimary: "var(--dsw-alias-label-primary, #0f1115)",
			labelSecondary: "var(--dsw-alias-label-secondary, #61666b)",
			labelTertiary: "var(--dsw-alias-label-tertiary, #81858c)",
			surface: "var(--dsw-alias-bg-module-platform, #f5f6f7)",
			inputBg: "var(--dsw-alias-bg-base, #fff)",
			inputBorder: "var(--dsw-alias-border-l4, rgb(0 0 0 / 16%))",
			hover: "var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5)",
			error: "var(--dsw-alias-state-error-primary, #ec1313)"
		};

		/** 14px is the settings panel's body size; everything here follows it. */
		const TEXT = { fontSize: 14, lineHeight: "22px" };

		const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Helvetica, Arial, sans-serif';

		/** A borderless grouped card, matching the panel's own setup cards. */
		const card = {
			background: T.surface,
			borderRadius: 12,
			padding: "14px 16px",
			marginBottom: 24
		};

		/** Label above an input, as inside a native setup card. */
		const fieldLabel = {
			display: "block",
			fontSize: 14,
			lineHeight: "22px",
			color: T.labelSecondary,
			marginBottom: 6
		};

		const field = {
			width: "100%",
			height: 32,
			padding: "0 10px",
			fontFamily: FONT,
			fontSize: 14,
			color: T.labelPrimary,
			background: T.inputBg,
			border: `1px solid ${T.inputBorder}`,
			borderRadius: 8,
			outline: "none",
			boxSizing: "border-box"
		};

		/** Section heading inside the panel. */
		const heading = {
			margin: "0 0 6px",
			fontSize: 16,
			lineHeight: "24px",
			fontWeight: 600,
			color: T.labelPrimary
		};

		/** Small caption introducing a group of rows. */
		const groupLabel = {
			margin: "0 0 10px",
			fontSize: 14,
			lineHeight: "22px",
			fontWeight: 600,
			color: T.labelPrimary
		};

		/** One `label ... value` row, matching the panel's read-only rows. */
		function row(key, label, value) {
			return h("div", { key, style: { display: "flex", alignItems: "baseline", gap: 16, padding: "7px 0" } }, [
				h("span", { key: "k", style: { ...TEXT, flex: "1 1 auto", minWidth: 0, color: T.labelPrimary } }, label),
				h("span", { key: "v", style: { ...TEXT, flex: "0 1 auto", maxWidth: "58%", textAlign: "right", color: T.labelSecondary, wordBreak: "break-word" } }, value)
			]);
		}

		/** A pill button. The real primitive is used when it resolves. */
		function pill(variant, props) {
			const base = {
				height: 32,
				padding: "0 16px",
				fontFamily: FONT,
				fontSize: 14,
				fontWeight: 500,
				borderRadius: 999,
				cursor: props.disabled === true ? "default" : "pointer",
				opacity: props.disabled === true ? 0.5 : 1
			};
			if (Button !== undefined) return h(Button, { ...props, variant });
			return h("button", {
				...props,
				style: {
					...base,
					border: variant === "primary" ? "0" : `1px solid ${T.inputBorder}`,
					background: variant === "primary" ? "var(--dsw-alias-brand-primary, #0f1115)" : "transparent",
					color: variant === "primary" ? "var(--dsw-alias-label-primary-foreground, #fff)" : T.labelPrimary
				}
			});
		}

		/**
		 * Pure view for the settings page.
		 * @param props.status - last `/__api/status` payload, or undefined while loading.
		 * @param props.form - current password-change draft `{ current, next, confirm }`.
		 * @param props.notice - `{ kind: "ok" | "error", text }` to show, or undefined.
		 * @param props.busy - whether a request is in flight.
		 * @param props.handlers - `{ onField, onPassword, onLogout, onReset }`.
		 * @returns the section element tree.
		 */
		function sectionView({ status, form, notice, busy, handlers }) {
			const children = [
				h("h2", { key: "h", style: heading }, "登录门禁"),
				h("p", { key: "lede", style: { margin: "0 0 24px", ...TEXT, color: T.labelSecondary } },
					"密码门禁独立于 Harness 自己的登录态：先过这道门，才轮到 Harness 的会话。")
			];

			if (notice !== undefined && notice !== null) {
				children.push(
					h("div", {
						key: "notice",
						role: "status",
						style: {
							margin: "0 0 16px",
							padding: "8px 12px",
							...TEXT,
							borderRadius: 8,
							color: notice.kind === "error" ? T.error : T.labelPrimary,
							background: notice.kind === "error" ? "transparent" : T.hover,
							border: `1px solid ${notice.kind === "error" ? T.error : "transparent"}`
						}
					}, notice.text)
				);
			}

			if (status === undefined || status === null) {
				children.push(h("p", { key: "loading", style: { margin: 0, ...TEXT, color: T.labelTertiary } }, "正在读取状态…"));
			} else {
				const locked = Array.isArray(status.locked) ? status.locked : [];
				children.push(
					h("div", { key: "status-card", style: card }, [
						row("passwordSet", "密码保护", status.passwordSet ? "已启用" : "未设置"),
						row("session", "本机登录态", "有效"),
						row("remember", "「记住我」时长", `${String(status.config.rememberDays)} 天`),
						row("short", "不勾选时", `${String(status.config.sessionHours)} 小时`),
						row("lockout", "失败锁定", `${String(status.config.maxFailures)} 次失败后锁定 ${String(status.config.lockoutSeconds)} 秒`),
						row("remote", "远程浏览器可用设置", status.config.unlockRemoteSettings ? "是" : "否"),
						row(
							"locked",
							"当前锁定中的来源",
							locked.length === 0
								? "无"
								: locked.map((entry) => `${entry.ip}（${String(entry.retryAfter)} 秒）`).join("、")
						)
					])
				);
			}

			children.push(
				h("div", { key: "pw-group" }, [
					h("div", { key: "pw-label", style: groupLabel }, "修改密码"),
					h("form", {
						key: "pw",
						style: card,
						onSubmit: (event) => {
							event.preventDefault();
							handlers.onPassword();
						}
					}, [
						h("label", { key: "l1", htmlFor: "wl-current", style: fieldLabel }, "当前密码"),
						h("input", {
							key: "current", id: "wl-current", type: "password", value: form.current,
							autoComplete: "current-password", style: field,
							onChange: (event) => handlers.onField("current", event.target.value)
						}),
						h("label", { key: "l2", htmlFor: "wl-next", style: { ...fieldLabel, marginTop: 14 } }, "新密码"),
						h("input", {
							key: "next", id: "wl-next", type: "password", value: form.next,
							autoComplete: "new-password", style: field,
							onChange: (event) => handlers.onField("next", event.target.value)
						}),
						h("label", { key: "l3", htmlFor: "wl-confirm", style: { ...fieldLabel, marginTop: 14 } }, "确认新密码"),
						h("input", {
							key: "confirm", id: "wl-confirm", type: "password", value: form.confirm,
							autoComplete: "new-password", style: field,
							onChange: (event) => handlers.onField("confirm", event.target.value)
						}),
						h("div", { key: "save-row", style: { display: "flex", justifyContent: "flex-end", marginTop: 16 } },
							pill("primary", { type: "submit", disabled: busy, children: busy ? "提交中…" : "保存" }))
					])
				])
			);

			children.push(
				h("div", { key: "session-group" }, [
					h("div", { key: "session-label", style: groupLabel }, "会话"),
					h("p", { key: "session-note", style: { margin: "0 0 14px", fontSize: 13, lineHeight: "20px", color: T.labelTertiary } },
						"退出登录只清掉这台设备的登录态。重置密码会删除已保存的密码，所有设备都要重新设置。"),
					h("div", { key: "actions", style: { display: "flex", gap: 8, flexWrap: "wrap" } }, [
						pill("outline", { key: "logout", type: "button", disabled: busy, onClick: () => handlers.onLogout(), children: "退出登录" }),
						pill("outline", { key: "reset", type: "button", disabled: busy, onClick: () => handlers.onReset(), style: { color: T.error }, children: "重置密码" })
					])
				])
			);

			return h("div", { style: { maxWidth: 564, fontFamily: FONT } }, children);
		}

		/** Read one JSON endpoint, normalising transport and application failures. */
		async function callApi(path, options) {
			const response = await fetch(path, {
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				...options
			});
			let body = {};
			try {
				body = await response.json();
			} catch {
				/* A non-JSON body means the request never reached the plugin. */
			}
			return { ok: response.ok, status: response.status, body };
		}

		/** The settings page: owns state, delegates rendering to {@link sectionView}. */
		function WebLoginSection() {
			const [status, setStatus] = React.useState(undefined);
			const [form, setForm] = React.useState({ current: "", next: "", confirm: "" });
			const [notice, setNotice] = React.useState(undefined);
			const [busy, setBusy] = React.useState(false);

			const refresh = React.useCallback(async () => {
				const result = await callApi("/__api/status", { method: "GET" });
				if (result.ok) setStatus(result.body);
				else setNotice({ kind: "error", text: `无法读取状态（HTTP ${String(result.status)}）` });
			}, []);

			React.useEffect(() => {
				void refresh();
			}, [refresh]);

			const handlers = {
				onField(key, value) {
					setForm((current) => ({ ...current, [key]: value }));
				},
				async onPassword() {
					if (form.next !== form.confirm) {
						setNotice({ kind: "error", text: "两次输入的新密码不一致" });
						return;
					}
					setBusy(true);
					const result = await callApi("/__api/password", {
						method: "POST",
						body: JSON.stringify({ current: form.current, next: form.next })
					});
					setBusy(false);
					if (result.ok) {
						setForm({ current: "", next: "", confirm: "" });
						setNotice({ kind: "ok", text: "密码已更新。其它设备上的登录态已失效。" });
						void refresh();
					} else {
						setNotice({ kind: "error", text: result.body.error ?? "修改失败" });
					}
				},
				async onLogout() {
					setBusy(true);
					await callApi("/__api/logout", { method: "POST", body: "{}" });
					/* The gate cookie is gone, so a reload lands on the login page. */
					window.location.reload();
				},
				async onReset() {
					const current = window.prompt("重置会删除已保存的密码，所有设备都需要重新设置。请输入当前密码以确认：");
					if (current === null) return;
					setBusy(true);
					const result = await callApi("/__api/reset", { method: "POST", body: JSON.stringify({ current }) });
					setBusy(false);
					if (result.ok) window.location.reload();
					else setNotice({ kind: "error", text: result.body.error ?? "重置失败" });
				}
			};

			return sectionView({ status, form, notice, busy, handlers });
		}

		/** Required service: the UI slot registry. */
		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "web-login",
						order: 90,
						label: () => "登录门禁"
					},
					WebLoginSection
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.WebLoginSection = WebLoginSection;
		exports.sectionView = sectionView;
		return module.exports;
	}
});
