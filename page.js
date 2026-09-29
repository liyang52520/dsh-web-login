/**
 * The gate's HTML surface.
 *
 * Styling mirrors Harness's own design system rather than inventing a palette:
 * the colours, font stack, sizes and radii below are taken from the shipped
 * theme tokens (`--dsw-alias-*` and the `--dsh-boot-*` fallbacks in the
 * frontend bundle), so the gate looks like a Harness dialog rather than a
 * bolt-on. The notable one is the accent: Harness's `brand-primary` is a near
 * black (`#0f1115`) in light mode and a near white (`#f9fafb`) in dark mode,
 * not a blue.
 *
 * Everything stays inline (no script, no external request) so the pages render
 * on a plain-HTTP origin with no network beyond the page itself. `theme` is
 * "auto" (follow the OS), "light" or "dark" (deployment override).
 */

/** Design tokens, named as Harness names them, with the shipped values. */
const TOKENS = `
:root {
  color-scheme: light;
  --bg-base: #fff;
  --bg-layer-1: #fff;
  --bg-layer-2: #f9fafb;
  --border-l1: rgb(0 0 0 / 4%);
  --border-l2: rgb(0 0 0 / 10%);
  --brand: #0f1115;
  --brand-hover: #43454a;
  --on-brand: #fff;
  --label-primary: #0f1115;
  --label-secondary: #61666b;
  --label-tertiary: #81858c;
  --label-caption: #adb2b8;
  --hover-solid: #f1f3f5;
  --error: #ec1313;
  --error-bg: #fef2f2;
  --error-border: #f7d4d4;
  --shadow: 0 6px 24px rgb(15 17 21 / 8%), 0 1px 2px rgb(15 17 21 / 6%);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg-base: #151517;
    --bg-layer-1: #232324;
    --bg-layer-2: #2c2c2e;
    --border-l1: rgb(255 255 255 / 6%);
    --border-l2: rgb(255 255 255 / 12%);
    --brand: #f9fafb;
    --brand-hover: #ebeef2;
    --on-brand: #0f1115;
    --label-primary: #f9fafb;
    --label-secondary: #cfd3d6;
    --label-tertiary: #adb2b8;
    --label-caption: #81858c;
    --hover-solid: #353638;
    --error: #f25a5a;
    --error-bg: #2b1b1b;
    --error-border: #4a2a2a;
    --shadow: none;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg-base: #151517;
  --bg-layer-1: #232324;
  --bg-layer-2: #2c2c2e;
  --border-l1: rgb(255 255 255 / 6%);
  --border-l2: rgb(255 255 255 / 12%);
  --brand: #f9fafb;
  --brand-hover: #ebeef2;
  --on-brand: #0f1115;
  --label-primary: #f9fafb;
  --label-secondary: #cfd3d6;
  --label-tertiary: #adb2b8;
  --label-caption: #81858c;
  --hover-solid: #353638;
  --error: #f25a5a;
  --error-bg: #2b1b1b;
  --error-border: #4a2a2a;
  --shadow: none;
}
`;

/** Component rules. Sizes follow Harness's 12/13/14/16px scale and 6/8/14px radii. */
const STYLE = `
${TOKENS}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg-base);
  color: var(--label-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 22px;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: 100%;
  max-width: 340px;
  padding: 24px;
  background: var(--bg-layer-1);
  border: 1px solid var(--border-l1);
  border-radius: 14px;
  box-shadow: var(--shadow);
}
h1 {
  margin: 0 0 4px;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: .01em;
}
p.sub { margin: 0; font-size: 13px; line-height: 20px; color: var(--label-tertiary); }
label {
  display: block;
  margin: 16px 0 6px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  color: var(--label-secondary);
}
input[type=password], input[type=text] {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  font-family: inherit;
  font-size: 14px;
  color: var(--label-primary);
  background: var(--bg-base);
  border: 1px solid var(--border-l2);
  border-radius: 8px;
  outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
input::placeholder { color: var(--label-caption); }
input:hover { border-color: var(--label-caption); }
input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgb(15 17 21 / 8%);
}
:root[data-theme="dark"] input:focus,
:root:not([data-theme="light"]) input:focus {
  box-shadow: 0 0 0 3px rgb(249 250 251 / 10%);
}
button {
  width: 100%;
  height: 36px;
  margin-top: 20px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--on-brand);
  background: var(--brand);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color .12s ease;
}
button:hover { background: var(--brand-hover); }
button:active { opacity: .9; }
button:focus-visible { outline: 2px solid var(--label-caption); outline-offset: 2px; }
.row { display: flex; align-items: center; gap: 8px; margin: 16px 0 0; }
.row input { width: 15px; height: 15px; margin: 0; accent-color: var(--brand); }
.row label {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  color: var(--label-secondary);
  cursor: pointer;
}
.err {
  margin: 16px 0 0;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 20px;
  color: var(--error);
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: 8px;
}
.hint { margin: 16px 0 0; font-size: 12px; line-height: 18px; color: var(--label-caption); }
.note { margin: 16px 0 0; font-size: 12px; line-height: 19px; color: var(--label-caption); }
code {
  padding: 1px 5px;
  font-family: "SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, Courier,
               "PingFang SC", "Microsoft YaHei", monospace;
  font-size: 12px;
  background: var(--hover-solid);
  border-radius: 6px;
}
pre {
  margin: 12px 0 0;
  padding: 12px;
  font-family: "SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, Courier,
               "PingFang SC", "Microsoft YaHei", monospace;
  font-size: 12px;
  line-height: 18px;
  color: var(--label-secondary);
  background: var(--bg-layer-2);
  border: 1px solid var(--border-l1);
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
`;

/** Escape a value interpolated into markup or an attribute. */
function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The `data-theme` attribute value, or "" to let the OS decide. */
function themeAttribute(theme) {
  return theme === "light" || theme === "dark" ? ` data-theme="${theme}"` : "";
}

/**
 * Wrap card content in the shared document shell.
 * @param title - browser tab title.
 * @param inner - card markup, already escaped by the caller.
 * @param theme - "auto", "light" or "dark".
 * @returns a complete HTML document.
 */
function layout(title, inner, theme) {
  return `<!doctype html>
<html lang="zh-CN"${themeAttribute(theme)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escape(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="card">
${inner}
</main>
</body>
</html>
`;
}

/** The password prompt returned for every request that has not passed the gate. */
export function loginPage({ title, error, theme }) {
  const error_markup = error === undefined ? "" : `<div class="err" role="alert">${escape(error)}</div>`;
  return layout(`${title} · 登录`, `<h1>${escape(title)}</h1>
<p class="sub">需要密码才能继续</p>
${error_markup}
<form method="post" action="/__login" autocomplete="on">
  <label for="password">密码</label>
  <input id="password" name="password" type="password" required autofocus
         autocomplete="current-password" spellcheck="false">
  <div class="row">
    <input id="remember" name="remember" type="checkbox" value="1" checked>
    <label for="remember">记住我</label>
  </div>
  <button type="submit">进入</button>
</form>`, theme);
}

/**
 * The first-run page: it creates the password instead of checking one. The
 * one-time setup token from the process log proves the caller is the operator,
 * because the page is reachable by anyone who can reach the port.
 */
export function setupPage({ title, error, minLength, needsToken, theme }) {
  const error_markup = error === undefined ? "" : `<div class="err" role="alert">${escape(error)}</div>`;
  const token_field = needsToken
    ? `<label for="setup">初始化口令</label>
  <input id="setup" name="setup" type="text" required autofocus spellcheck="false"
         autocomplete="off" placeholder="见服务日志 dsh web-login:">
  `
    : "";
  const focus = needsToken ? "" : " autofocus";
  const note = needsToken
    ? `<p class="hint">初始化口令打印在服务启动日志里：<br><code>journalctl -u dsh | grep 'dsh web-login'</code></p>`
    : "";
  return layout(`${title} · 设置密码`, `<h1>${escape(title)}</h1>
<p class="sub">首次使用，请设置访问密码</p>
${error_markup}
<form method="post" action="/__login" autocomplete="off">
  ${token_field}<label for="password">新密码</label>
  <input id="password" name="password" type="password" required${focus}
         minlength="${escape(minLength)}" autocomplete="new-password" spellcheck="false">
  <label for="confirm">确认密码</label>
  <input id="confirm" name="confirm" type="password" required
         minlength="${escape(minLength)}" autocomplete="new-password" spellcheck="false">
  <button type="submit">设置并进入</button>
</form>
<p class="note">至少 ${escape(minLength)} 位。密码以 scrypt 加盐哈希保存在 <code>$DSH_HOME/.credentials.yaml</code>；忘记后删掉其中 <code>dsh-web-login/state</code> 一项并重启即可重设。</p>
${note}`, theme);
}

/**
 * Change-password form, shown only to a caller that already holds a valid gate
 * cookie, so it re-checks the current password instead of trusting the cookie.
 */
export function accountPage({ title, error, minLength, theme }) {
  const error_markup = error === undefined ? "" : `<div class="err" role="alert">${escape(error)}</div>`;
  return layout(`${title} · 改密码`, `<h1>${escape(title)}</h1>
<p class="sub">修改访问密码</p>
${error_markup}
<form method="post" action="/__account" autocomplete="off">
  <label for="current">当前密码</label>
  <input id="current" name="current" type="password" required autofocus
         autocomplete="current-password" spellcheck="false">
  <label for="password">新密码</label>
  <input id="password" name="password" type="password" required
         minlength="${escape(minLength)}" autocomplete="new-password" spellcheck="false">
  <label for="confirm">确认新密码</label>
  <input id="confirm" name="confirm" type="password" required
         minlength="${escape(minLength)}" autocomplete="new-password" spellcheck="false">
  <button type="submit">保存</button>
</form>
<p class="note">至少 ${escape(minLength)} 位。改完会轮换会话密钥，其它设备上的登录态立即失效，当前这台保持登录。</p>`, theme);
}

/** A minimal standalone page for 403/429/503 and other gate-owned refusals. */
export function messagePage({ title, heading, body, detail, theme }) {
  const detail_markup = detail === undefined ? "" : `<p class="note">${escape(detail)}</p>`;
  return layout(`${title} · ${heading}`, `<h1>${escape(heading)}</h1>
<p class="sub">${escape(body)}</p>
${detail_markup}`, theme);
}

/** Diagnostic page for a request Harness's Host/Origin fence refused. */
export function fencePage({ title, host, hint, theme }) {
  return layout(`${title} · 请求被拒`, `<h1>请求被 Harness 拒绝</h1>
<p class="sub">Host 或 Origin 不在信任范围内，所有接口都会失败。</p>
<div class="err" role="alert">Harness 看到的 Host: <strong>${escape(host)}</strong></div>
<p class="note">如果经反向代理或公网 IP 访问，需要两处配合：</p>
<pre>${escape(hint)}</pre>`, theme);
}
