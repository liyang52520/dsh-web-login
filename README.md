# dsh-web-login

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI 加一道独立的密码门。

Host-only 插件，**零运行时依赖**，不碰 `/api`，也不改动 Harness 自身的鉴权。

> A password gate for the DeepSeek Harness Web GUI: first-run password setup,
> remember-me sessions, and brute-force lockout. Host-only Cordis plugin with no
> runtime dependencies.

---

## 它解决什么问题

Harness 本身会鉴权，但凭证是 `dsh web` 启动时打印的那个一次性 token URL：

```
dsh web: http://127.0.0.1:3080/?token=0Ncme-2o6j0SI2MKI0MkRzxDc9qtAdK3fhIx0k7kweE
```

这个 URL 一旦进了日志、聊天记录、nginx 访问日志，**拿到它的人就直接进来了**（Harness 的会话 cookie 会按请求的 Host 签发，默认有效 30 天）。而 `dsh web` 只监听回环地址，你要从外面访问就必须经反代把 token URL 暴露出去，这一步几乎不可避免。

本插件在文档层前面加一道独立的密码：

- `/` 由插件接管。没通过密码就只给登录页，**不会**把启动 token 转发给 Harness，所以 token 在没有密码时是废的。
- `/index.html` 一并接管（能定位到前端产物时），应用页面没有绕过入口。
- `/api` 以及其它所有路由完全不动，Harness 自己的 Host/Origin 信任栅栏与浏览器鉴权照常生效。

## 特性

- **首次运行设置密码**，用日志里打印的一次性初始化口令保护，避免公网扫描器抢先占位
- **记住我**：勾选后默认 30 天，不勾默认 12 小时，两者都可配
- **连续失败锁定**：同一来源失败 5 次锁定 300 秒，按真实客户端 IP 计数
- **服务重启不用重抄 token**：登录态还在时自动用新进程的 token 补签 Harness 会话
- 密码以 scrypt 加盐哈希存储，登录态 cookie 为 HMAC-SHA256 签名并绑定 authority
- 零依赖，只 import `node:` 内置模块，升级 Harness 不会因内部 API 变动而加载失败

## 兼容性

| dsh 版本 | 状态 |
|---|---|
| `0.2.0-rc.2` | 部署并全量验证（Linux + nginx 反代 + WebSocket） |
| `0.1.2-rc.1` | 开发与全量测试（macOS） |

依赖的 Harness 公开 Service 只有三个：`connection.authorizeIndex()`、`connection.authenticatedUrl()`、`connection.requestRejection()`，加上 `webServer` 的 exact 路由注册与 `credentials` 的记录读写。

## 安装

### 方式一：用 `dsh plugin`（推荐，需要 pnpm）

```bash
git clone git@github.com:liyang52520/dsh-web-login.git /opt/dsh-web-login
dsh plugin --profile web add /opt/dsh-web-login
sudo systemctl restart dsh          # 服务名按你的实际情况改
```

因为本包声明了 `dsh.bundle`，`dsh plugin add` 会把它**自动追加进 `dsh.profile.bundles` 并激活**，不需要手动编辑任何 patch 文件。装完 `$DSH_HOME/profiles/web/package.json` 里会多出依赖和 bundles 条目。

### 方式二：不用 pnpm（手动，适用于没装 pnpm 的机器）

```bash
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
git clone git@github.com:liyang52520/dsh-web-login.git /opt/dsh-web-login

# 复制成真实目录（不要用符号链接：Node 会把 import.meta.url 解析成链接目标，
# 导致插件定位不到前端产物）
mkdir -p "$DSH_HOME/profiles/web/node_modules"
cp -a /opt/dsh-web-login "$DSH_HOME/profiles/web/node_modules/dsh-web-login"

# 写入 profile 用户补丁层
cat > "$DSH_HOME/profiles/web/cordis.patch.yml" <<'EOF'
- insert:
    - id: web-login
      name: dsh-web-login
EOF

sudo systemctl restart dsh
```

> 注意：插件通过 `import.meta.url` 与 `$DSH_HOME/profiles/node_modules` 定位前端产物。用符号链接安装会让 `import.meta.url` 指向源目录，此时若前端包不在上溯路径里，`/index.html` 会退化为不设防（`/` 仍受保护）。方式二用 `cp -a` 复制成真实目录可以规避；真的遇到时服务日志会打印明确警告，也可以直接用配置项 `indexHtml` 指定路径。

### 验证安装

```bash
journalctl -u dsh -n 20 --no-pager | grep 'dsh web-login'
```

首次启动会打印一次性初始化口令：

```
dsh web-login: 尚未设置密码，首次打开页面时填写下面的初始化口令
dsh web-login: setup-token: 7rJfiimRBtBZbZZqbEY3_O6VBO3Te-bA
```

**没打印初始化口令，说明密码已经设过了。**

## 首次使用

1. 浏览器打开 `http://<你的地址>/`
2. 页面要求填「初始化口令」，填日志里那串，再设一个至少 8 位的密码
3. 提交后自动登录并进入 Harness

初始化口令只在**尚未设置密码**时存在，每次进程启动重新生成，设置完成后立即失效。

这一步不能省：公网 IP 上扫描器随时会到，如果允许任何人抢先设密码，等于把整机交给第一个访问者（Jupyter 早年那个经典问题）。

如果你是从服务器本机或 SSH 隧道访问，可以打开 `allowLoopbackSetup: true` 免填初始化口令。

## 配置

在 `$DSH_HOME/profiles/web/cordis.patch.yml` 里按行 id 覆盖。用户层在所有 bundle 之后应用，且**整块替换** `config`，所以要把想保留的键都写全：

```yaml
- id: web-login
  config:
    title: 我的服务器
    rememberDays: 90
    passwordMinLength: 10
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 置 `false` 可临时关掉这道门，不用卸载 |
| `title` | `DeepSeek Harness` | 登录卡片上的标题 |
| `passwordMinLength` | `8` | 新密码最小长度 |
| `rememberDays` | `30` | 勾选「记住我」时的登录态天数 |
| `sessionHours` | `12` | 不勾时的登录态小时数 |
| `maxFailures` | `5` | 同一来源连续失败几次后锁定 |
| `lockoutSeconds` | `300` | 锁定时长 |
| `clientIpHeader` | `x-real-ip` | 从哪个请求头取真实客户端 IP 做限流；置空串则用 socket 地址 |
| `allowLoopbackSetup` | `false` | 允许本机来源跳过初始化口令 |
| `indexHtml` | `""` | 手动指定前端 `index.html` 路径，留空则自动定位 |
| `unlockRemoteSettings` | `true` | 让远程（非回环）浏览器也能用 host 侧设置，见下节 |

`clientIpHeader` 默认信任 `X-Real-IP`。这是成立的，因为 Harness 只监听回环地址，只有 nginx 能到达该端口，而 nginx 的 `proxy_set_header X-Real-IP $remote_addr` 会覆盖客户端伪造的值。**如果你把 Harness 直接暴露到公网（不推荐），这个头就是可伪造的，应置空。**

## 远程访问与设置（`unlockRemoteSettings`）

Harness 依据**浏览器地址栏的 hostname**决定 host 侧设置是否可用：

```js
const transport = globalThis.__DSH_TRANSPORT__;
isLoopback: transport?.ownsHost === true || pageLocation === void 0
            || isLoopbackHostname(pageLocation.hostname)   // 只认 localhost / [::1] / 127.x
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
```

用公网 IP 或域名访问时不是回环，设置被降级为 `memory` 模式，于是：

- 设置界面（模型 / 提供商 / 插件配置 / 常规）报 `settings are unavailable in this browser`，或整页空白
- 预览版说明弹窗每次刷新都会重现（确认状态只存在浏览器内存里）

`ownsHost` 是上面表达式里的第一个子句，而 Harness **从不给它赋值** —— 是个空着的钩子。本插件通过官方扩展点 `webserver/index-inject` 往页头注入一行：

```js
globalThis.__DSH_TRANSPORT__ = globalThis.__DSH_TRANSPORT__ || {};
globalThis.__DSH_TRANSPORT__.ownsHost = true;
```

**不改任何 JavaScript、不改 Harness 安装目录、零运行时开销，且升级 Harness 后依然有效。** 这也是 `dsh-public-access` 采用的办法；相比之下，靠字符串改写客户端 bundle（如 `dsh-web-pass`、`dsh-web-auth-gateway`）会在 Harness 改动表达式时静默失效。

**为什么是安全的**：注入只出现在本插件返回的 index 里，而本插件只在**密码门 + Harness 自身鉴权都通过**之后才返回 index。所以它到达不了未登录的人。服务端的 Host/Origin 信任栅栏完全不涉及这个变量。

**副作用与关闭方式**：开启后远程浏览器获得与本机访问同等的 host 设置读写能力。如果你不希望如此（例如只想让远程用户看不能改），置 `false`：

```yaml
- id: web-login
  config:
    unlockRemoteSettings: false
```

## 日常操作

**退出登录**：访问 `http://<你的地址>/__logout`。它会同时清掉本插件的 cookie 和 Harness 的会话 cookie，两者都失效才算真的退出。

**忘记密码 / 改密码**：停服务，编辑 `$DSH_HOME/.credentials.yaml`，删掉 `dsh-web-login/state` 那一段，重启。下次打开页面会重新进入首次设置流程。

```yaml
dsh-web-login/state:        # ← 连下面几行一起删
  kind: grant
  payload:
    version: 1
    algorithm: scrypt
    # ...
```

**卸载**：

```bash
dsh plugin --profile web remove dsh-web-login
sudo systemctl restart dsh
```

手动安装的则删掉 `$DSH_HOME/profiles/web/node_modules/dsh-web-login` 并把 `cordis.patch.yml` 改回 `[]`。

## 工作原理

浏览器访问 `/` 时的判定顺序：

```
浏览器 GET /
   │
   ├─ 本插件的 exact 路由 / 接管（优先级高于 Harness 内置的 SPA fallback）
   │
   ├─ 没有 dsh_gate cookie ──► 登录页
   │                          （此时即使 URL 带 ?token= 也不转发，所以 token 是废的）
   │
   └─ 有 dsh_gate cookie
        ├─ 带 ?token= ──► 交给 connection.authorizeIndex()
        │                 Harness 校验 token 并下发自己的会话 cookie，303 到 /
        ├─ Harness 未鉴权 ──► 303 到当前进程的 token URL，自动补签 Harness 会话
        └─ Harness 已鉴权 ──► 渲染并返回真正的应用页面
```

关键设计：**插件不自己签发 Harness 的会话 cookie**（那需要 Harness 的内部签名密钥），而是替已通过密码的用户去"花掉"当前进程的启动 token。这样既不用复制 Harness 的加密逻辑，也让 token 在没密码时完全无效。

「记住我」只控制本插件 cookie 的有效期。Harness 的会话过期后，只要本插件 cookie 还在，访问 `/` 会用当前进程的新 token 自动补签，所以**服务重启不需要你重新去日志里抄 token**。

**占用的路由**（与其它插件冲突时看这里）：

| 路由 | 用途 |
|---|---|
| `/` | 登录门禁 + 渲染应用首页 |
| `/index.html` | 同上（仅当能定位到前端产物时注册） |
| `/__login` | 登录 / 首次设置表单 |
| `/__logout` | 清理登录态 |

## 排障

**日志出现「未能定位前端 index.html，`/index.html` 未纳入密码保护」。**

`/` 仍然受保护，应用只能从 `/` 进入；但 `/index.html` 会落回 Harness 自己的处理（未登录时显示 Harness 那段 401 文本）。在 profile 的 patch 里显式指定路径即可：

```yaml
- id: web-login
  config:
    indexHtml: /usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html
```

实际路径用 `readlink -f "$(which dsh)"` 找到安装目录后拼出来，或 `find / -path '*dsh-web-frontend/dist/index.html' 2>/dev/null`。

**忘了初始化口令。** 口令只在首次设置前存在，重启服务会打印一个新的。

**登录后一直跳回登录页。** 登录态 cookie 绑定了 authority（域名或 IP，含端口）。从 `http://ip:8080` 换成 `http://ip` 访问、或换域名，都需要重新登录一次。

**反代后接口 403。** 确认 Harness 的 `--trusted-host` 与浏览器地址栏一致，且 nginx 透传了真实 `Host`/`Origin`（`proxy_set_header Host $http_host;`）。

## 安全说明（请务必读完）

### 明文 HTTP 下，这道门挡得住谁、挡不住谁

**挡得住**：扫描器、僵尸网络、拿到 URL 但不在你网络链路上的陌生人、误入的同事。他们看到的是登录页，`/api` 也调不动。

**挡不住**：**链路上的窃听者**。你的密码、本插件的 cookie、Harness 的 cookie 全都是明文过网，中间人抓包就能拿到会话。这不是插件的问题，是明文 HTTP 的固有问题。

因此如果条件允许，**SSH 隧道比暴露端口好得多**，而且不需要域名和证书：

```bash
ssh -N -L 3080:127.0.0.1:3080 user@你的服务器
# 然后本地打开 http://127.0.0.1:3080/
```

此时端口根本没开到公网，本插件仍然照常工作（多一道密码）。同理，Tailscale / WireGuard 这类私有网络也比公网明文好。

### 其它已知边界

- 密码用 scrypt（N=16384, r=8, p=1）加盐哈希，存在 `$DSH_HOME/.credentials.yaml`（0600 权限），与 Harness 自己的浏览器会话密钥放在同一个文件里。
- 登录态 cookie 是 HMAC-SHA256 签名的，并绑定到请求的 authority。伪造或换 host 都无效。
- 限流按来源 IP 记在**内存**里，重启即清零。它防的是单个来源的暴力破解，不防分布式慢速爆破。
- `/__logout` 接受 GET，所以可以被第三方页面诱导触发（CSRF logout）。后果仅仅是登出，无其它影响。
- 退出时会顺手让 Harness 的会话 cookie 过期。这依赖 Harness 内部的 cookie 命名规则（`dsh-auth-` + sha256(authority)）。若将来 Harness 改了命名，只是退出时清不掉它，不影响门禁本身。
- 这个插件拥有宿主进程的全部权限。请只使用你读过的版本，不要从不明来源安装同名的包。

## 文件结构

```
.
├── index.js            # 插件主体：路由接管、密码存储、cookie、限流
├── page.js             # 登录页 / 首次设置页 / 提示页的 HTML 与样式
├── cordis.patch.yml    # bundle 补丁：把本插件插入 profile 根
├── package.json        # 声明 dsh.bundle，使 dsh plugin add 能自动激活
└── README.md
```

## License

[MIT](LICENSE)
