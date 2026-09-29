/**
 * The gate's HTML surface: one shared layout plus the login, first-run setup,
 * and plain-message pages. Everything is inline (no script, no external
 * request), so the pages render even on an air-gapped or plain-HTTP origin.
 */

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
        "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
  background: #f5f6f8; color: #1b1d21;
}
.card {
  width: 100%; max-width: 350px; padding: 28px;
  background: #fff; border: 1px solid #e4e6ea; border-radius: 14px;
  box-shadow: 0 8px 30px rgba(15, 20, 40, .07);
}
h1 { margin: 0 0 4px; font-size: 18px; font-weight: 650; letter-spacing: .1px; }
p.sub { margin: 0 0 4px; font-size: 13px; color: #6b7280; }
label { display: block; margin: 16px 0 6px; font-size: 13px; font-weight: 550; color: #3b4048; }
input[type=password], input[type=text] {
  width: 100%; padding: 10px 12px; font-size: 15px; color: inherit;
  background: #fff; border: 1px solid #d4d7dd; border-radius: 9px;
}
input:focus { outline: 2px solid #2f6bf3; outline-offset: -1px; border-color: transparent; }
button {
  width: 100%; margin-top: 22px; padding: 11px; font-size: 15px; font-weight: 600;
  color: #fff; background: #2f6bf3; border: 0; border-radius: 9px; cursor: pointer;
}
button:hover { background: #2559d8; }
button:active { background: #1f4bbd; }
.row { display: flex; align-items: center; gap: 8px; margin: 16px 0 0; font-size: 13.5px; color: #4b5563; }
.row input { width: 16px; height: 16px; accent-color: #2f6bf3; }
.row label { margin: 0; font-weight: 400; font-size: 13.5px; color: inherit; }
.err {
  margin: 18px 0 0; padding: 10px 12px; font-size: 13.5px; line-height: 1.5;
  background: #fdecec; color: #a3262c; border: 1px solid #f6cdcd; border-radius: 9px;
}
.hint { margin: 20px 0 0; font-size: 12.5px; color: #8a8f98; }
.hint code {
  padding: 1px 5px; border-radius: 4px; background: rgba(127, 127, 127, .14);
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.note { margin: 18px 0 0; font-size: 12.5px; color: #8a8f98; line-height: 1.6; }
@media (prefers-color-scheme: dark) {
  body { background: #16181c; color: #e8eaed; }
  .card { background: #1e2126; border-color: #2f333b; box-shadow: none; }
  p.sub, .row { color: #9aa1ab; }
  label { color: #c2c7ce; }
  input[type=password], input[type=text] { background: #15171b; border-color: #383d46; }
  .err { background: #2d1a1c; color: #f0a9ae; border-color: #5b2c30; }
  .hint, .note { color: #7e858f; }
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

/**
 * Wrap card content in the shared document shell.
 * @param title - browser tab title.
 * @param inner - card markup, already escaped by the caller.
 * @returns a complete HTML document.
 */
function layout(title, inner) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
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
export function loginPage({ title, error }) {
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
</form>`);
}

/**
 * The first-run page: it creates the password instead of checking one. The
 * one-time setup token from the process log proves the caller is the operator,
 * because the page is reachable by anyone who can reach the port.
 */
export function setupPage({ title, error, minLength, needsToken }) {
  const error_markup = error === undefined ? "" : `<div class="err" role="alert">${escape(error)}</div>`;
  const token_field = needsToken
    ? `<label for="setup">初始化口令</label>
  <input id="setup" name="setup" type="text" required autofocus spellcheck="false"
         autocomplete="off" placeholder="见服务日志 dsh web-login:">
  `
    : "";
  const focus = needsToken ? "" : " autofocus";
  const note = needsToken
    ? `<p class="hint">初始化口令打印在服务启动日志里，取法：<br><code>journalctl -u dsh-web | grep 'dsh web-login'</code></p>`
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
<p class="note">至少 ${escape(minLength)} 位。密码以 scrypt 加盐哈希保存在 <code>$DSH_HOME/.credentials.yaml</code>，忘记后删掉其中 <code>dsh-web-login/state</code> 一项并重启即可重设。</p>
${note}`);
}

/** A minimal standalone page for 403/429/503 and other gate-owned refusals. */
export function messagePage({ title, heading, body, detail }) {
  const detail_markup = detail === undefined ? "" : `<p class="note">${escape(detail)}</p>`;
  return layout(`${title} · ${heading}`, `<h1>${escape(heading)}</h1>
<p class="sub">${escape(body)}</p>
${detail_markup}`);
}

/**
 * Change-password form, shown only to a caller that already holds a valid gate
 * cookie, so it re-checks the current password instead of trusting the cookie.
 */
export function accountPage({ title, error, minLength }) {
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
<p class="note">至少 ${escape(minLength)} 位。改完会轮换会话密钥，其它设备上的登录态立即失效，当前这台保持登录。</p>`);
}

/** Diagnostic page for a request Harness's Host/Origin fence refused. */
export function fencePage({ title, host, hint }) {
  return layout(`${title} · 请求被拒`, `<h1>请求被 Harness 拒绝</h1>
<p class="sub">Host 或 Origin 不在信任范围内，所有接口都会失败。</p>
<div class="err" role="alert">Harness 看到的 Host: <strong>${escape(host)}</strong></div>
<p class="note">如果经反向代理或公网 IP 访问，需要两处配合：</p>
<pre class="hint" style="white-space:pre-wrap">${escape(hint)}</pre>`);
}
