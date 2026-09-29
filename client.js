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

		/** Harness's own tokens, with the shipped values as fallbacks. */
		const T = {
			labelPrimary: "var(--dsw-alias-label-primary, #0f1115)",
			labelSecondary: "var(--dsw-alias-label-secondary, #61666b)",
			labelTertiary: "var(--dsw-alias-label-tertiary, #81858c)",
			border: "var(--dsw-alias-border-l2, rgb(0 0 0 / 10%))",
			base: "var(--dsw-alias-bg-base, #fff)",
			hover: "var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5)",
			brand: "var(--dsw-alias-brand-primary, #0f1115)",
			onBrand: "var(--dsw-alias-label-primary-foreground, #fff)",
			error: "var(--dsw-alias-state-error-primary, #ec1313)"
		};

		const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Helvetica, Arial, sans-serif';
		const MONO = '"SF Mono", "JetBrains Mono", Consolas, Menlo, monospace';

		const field = {
			width: "100%",
			height: 32,
			padding: "0 8px",
			fontFamily: FONT,
			fontSize: 13,
			color: T.labelPrimary,
			background: T.base,
			border: `1px solid ${T.border}`,
			borderRadius: 8,
			outline: "none",
			boxSizing: "border-box"
		};

		function button(variant) {
			return {
				height: 32,
				padding: "0 14px",
				fontFamily: FONT,
				fontSize: 13,
				fontWeight: 500,
				borderRadius: 8,
				cursor: "pointer",
				border: variant === "primary" ? "0" : `1px solid ${T.border}`,
				background: variant === "primary" ? T.brand : "transparent",
				color: variant === "primary" ? T.onBrand : T.labelPrimary
			};
		}

		/** One `label: value` row of the status table. */
		function row(key, label, value) {
			return h("div", { key, style: { display: "flex", gap: 12, padding: "6px 0", fontSize: 13, lineHeight: "20px" } }, [
				h("span", { key: "k", style: { flex: "0 0 132px", color: T.labelSecondary } }, label),
				h("span", { key: "v", style: { color: T.labelPrimary, wordBreak: "break-word" } }, value)
			]);
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
			const children = [];

			children.push(
				h("p", { key: "lede", style: { margin: "0 0 16px", fontSize: 13, lineHeight: "20px", color: T.labelSecondary } },
					"这个页面控制 DeepSeek Harness 的密码门禁。它独立于 Harness 自己的登录态。")
			);

			if (notice !== undefined && notice !== null) {
				children.push(
					h("div", {
						key: "notice",
						role: "status",
						style: {
							margin: "0 0 16px",
							padding: "8px 10px",
							fontSize: 13,
							lineHeight: "20px",
							borderRadius: 8,
							color: notice.kind === "error" ? T.error : T.labelPrimary,
							background: notice.kind === "error" ? "transparent" : T.hover,
							border: `1px solid ${notice.kind === "error" ? T.error : T.border}`
						}
					}, notice.text)
				);
			}

			if (status === undefined || status === null) {
				children.push(h("p", { key: "loading", style: { margin: 0, fontSize: 13, color: T.labelTertiary } }, "正在读取状态…"));
			} else {
				const locked = Array.isArray(status.locked) ? status.locked : [];
				children.push(
					h("div", { key: "status", style: { marginBottom: 24 } }, [
						row("passwordSet", "密码保护", status.passwordSet ? "已启用" : "未设置"),
						row("session", "本机登录态", "有效"),
						row("remember", "「记住我」时长", `${String(status.config.rememberDays)} 天`),
						row("session", "不勾选时", `${String(status.config.sessionHours)} 小时`),
						row("lockout", "失败锁定策略", `连续 ${String(status.config.maxFailures)} 次失败后锁定 ${String(status.config.lockoutSeconds)} 秒`),
						row(
							"locked",
							"当前锁定中的来源",
							locked.length === 0
								? "无"
								: locked.map((entry) => `${entry.ip}（还剩 ${String(entry.retryAfter)} 秒，累计 ${String(entry.failures)} 次）`).join("；")
						),
						row("remote", "远程浏览器可用设置", status.config.unlockRemoteSettings ? "是" : "否")
					])
				);
			}

			children.push(
				h("h3", { key: "pw-title", style: { margin: "0 0 4px", fontSize: 14, lineHeight: "22px", fontWeight: 600, color: T.labelPrimary } }, "修改密码"),
				h("form", {
					key: "pw",
					onSubmit: (event) => {
						event.preventDefault();
						handlers.onPassword();
					}
				}, [
					h("label", { key: "l1", style: { display: "block", margin: "12px 0 6px", fontSize: 13, color: T.labelSecondary } }, "当前密码"),
					h("input", {
						key: "current",
						type: "password",
						value: form.current,
						autoComplete: "current-password",
						style: field,
						onChange: (event) => handlers.onField("current", event.target.value)
					}),
					h("label", { key: "l2", style: { display: "block", margin: "12px 0 6px", fontSize: 13, color: T.labelSecondary } }, "新密码"),
					h("input", {
						key: "next",
						type: "password",
						value: form.next,
						autoComplete: "new-password",
						style: field,
						onChange: (event) => handlers.onField("next", event.target.value)
					}),
					h("label", { key: "l3", style: { display: "block", margin: "12px 0 6px", fontSize: 13, color: T.labelSecondary } }, "确认新密码"),
					h("input", {
						key: "confirm",
						type: "password",
						value: form.confirm,
						autoComplete: "new-password",
						style: field,
						onChange: (event) => handlers.onField("confirm", event.target.value)
					}),
					h("button", {
						key: "save",
						type: "submit",
						disabled: busy,
						style: { ...button("primary"), marginTop: 16, opacity: busy ? 0.6 : 1 }
					}, busy ? "提交中…" : "保存")
				])
			);

			children.push(
				h("h3", { key: "session-title", style: { margin: "28px 0 4px", fontSize: 14, lineHeight: "22px", fontWeight: 600, color: T.labelPrimary } }, "会话"),
				h("p", { key: "session-note", style: { margin: "0 0 12px", fontSize: 12, lineHeight: "19px", color: T.labelTertiary } },
					"「退出登录」只清掉本机的登录态。「重置密码」会删除已保存的密码，所有设备都要重新设置。"),
				h("div", { key: "actions", style: { display: "flex", gap: 8, flexWrap: "wrap" } }, [
					h("button", {
						key: "logout",
						type: "button",
						disabled: busy,
						style: button("secondary"),
						onClick: () => handlers.onLogout()
					}, "退出登录"),
					h("button", {
						key: "reset",
						type: "button",
						disabled: busy,
						style: { ...button("secondary"), color: T.error, borderColor: T.error },
						onClick: () => handlers.onReset()
					}, "重置密码")
				])
			);

			return h("div", { style: { maxWidth: 520, fontFamily: FONT } }, children);
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
