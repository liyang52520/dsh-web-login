# dsh-web-login

给 **DeepSeek Harness** Web GUI 加一道独立的密码门。零运行时依赖的 Cordis 插件：不碰 `/api`，也不改动 Harness 自身的鉴权。

> A password gate for the DeepSeek Harness Web GUI: first-run password setup,
> remember-me sessions, brute-force lockout, and a management page inside
> Harness's own settings. No runtime dependencies.

![登录页](docs/login.png)

## 它解决什么问题

把 `dsh web` 通过 nginx 暴露出去，直接访问通常只会得到：

> dsh web authentication required; reopen the URL printed by dsh web.

Harness 的 `--trusted-host` 只解决「谁算合法 Host」，而那个凭证是启动时打印的一次性 token URL —— 一旦进了日志或聊天记录，拿到的人就直接进来了。本插件在最前面加一道自己的密码：

- `/` 由插件接管。**没过密码就只给登录页，不会把启动 token 转发给 Harness**，所以 token 在没有密码时是废的
- `/index.html` 一并接管（能定位到前端产物时），应用页面没有绕过入口
- Harness 自己的 `/api/*` 以及其它所有路由完全不动，它的 Host/Origin 栅栏与鉴权照常生效（插件自己的 JSON 接口挂在另一条前缀 `/__api/*` 下）

## 特性

- 首次打开自动进入设置流程，用日志里的一次性口令保护，**防止公网扫描器抢先占位**
- 「记住我」默认 30 天，不勾选默认 12 小时，都可配
- 连续失败锁定（默认 5 次锁 300 秒），按真实客户端 IP 计数
- **审计日志**：登录成败、改密、锁定、退出都往 journal 打一行，且不含密码内容
- **在 Harness 设置页里管理**：改密码 / 重置密码 / 退出登录，都是弹窗，不用记 URL
- 密码以 scrypt 加盐哈希存储，登录态 cookie 为 HMAC-SHA256 签名并绑定 authority

## 安装

需要 pnpm。没有的话先 `npm i -g pnpm`。

```bash
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
cd "$PROFILE"
pnpm add 'github:liyang52520/dsh-web-login'
```

然后在同目录的 `cordis.patch.yml` 里加上这一行（**已有其它内容就追加，不要覆盖**）：

```yaml
- insert:
    - id: web-login
      name: dsh-web-login
```

重启服务：

```bash
systemctl restart dsh        # 服务名按你的实际情况改
```

升级就是重跑一次 `pnpm add` 再重启，不用动配置文件。

<details>
<summary>其它安装方式</summary>

**用官方的 `dsh plugin`** —— 本包声明了 `dsh.bundle`，这条命令本该自动把它追加进 `dsh.profile.bundles`，不需要手写上面的 `insert`：

```bash
dsh plugin --profile web add git+https://github.com/liyang52520/dsh-web-login.git
```

> ⚠️ **注意 `DSH_HOME`。** 这条命令按 `$DSH_HOME`（未设置时是 `~/.dsh`）决定操作哪个 profile。如果传错了，它会**安静地在另一个路径下新建一个 profile 并装好** —— pnpm 报成功、退出码 0，但线上实例毫无变化。先确认服务的真实 profile 再执行。

**不用 pnpm**：`git clone` 之后把受版本控制的文件复制进去，再写上面那段 `insert`：

```bash
git clone https://github.com/liyang52520/dsh-web-login.git /opt/dsh-web-login
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
mkdir -p "$PROFILE/node_modules/dsh-web-login"
git -C /opt/dsh-web-login archive HEAD | tar -x -C "$PROFILE/node_modules/dsh-web-login"
```

</details>

## 首次使用

重启后日志里会打印一次性初始化口令：

```
dsh web-login: 尚未设置密码，首次打开页面时填写下面的初始化口令
dsh web-login: setup-token: 7rJfiimRBtBZbZZqbEY3_O6VBO3Te-bA
```

打开你的地址，填口令 + 设置密码就进去了。

## 日常使用

登录后进 **Harness 设置 → 登录门禁**：

![设置页](docs/settings.jpg)

| 操作 | 作用 |
|---|---|
| **修改密码** | 用旧密码换新密码，顺手轮换会话密钥 —— 其它设备立即掉线，当前这台保持登录 |
| **重置密码** | 删掉密码记录，所有设备重新走首次设置 |
| **退出登录** | 只清掉这台设备的登录态 |

> **为什么两个都留着？** 重置之后走的是首次设置流程，而首次设置**需要日志里的初始化口令**（`allowLoopbackSetup` 默认关闭）。所以如果只有重置，纯远程的用户每改一次密码都得 SSH 上去看日志。修改密码则是「用旧密码换新密码」，在浏览器里一步完成，不会把自己锁在门外。

配色跟着 Harness 的主题走：

![深色](docs/settings-dark.jpg)

## 配置

在 `cordis.patch.yml` 里按行 id 覆盖。注意 **`config` 是整块替换**，写几个生效几个：

```yaml
- id: web-login
  config:
    title: 我的 Harness
    rememberDays: 7
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 设为 `false` 则完全不接管路由 |
| `title` | `"DeepSeek Harness"` | 页面标题与登录页标题 |
| `passwordMinLength` | `8` | 密码最短长度 |
| `rememberDays` | `30` | 勾「记住我」时的登录态天数 |
| `sessionHours` | `12` | 不勾时的登录态小时数 |
| `maxFailures` | `5` | 连续失败几次后锁定 |
| `lockoutSeconds` | `300` | 锁定时长（秒） |
| `clientIpHeader` | `"x-real-ip"` | 从哪个头取真实客户端 IP，决定限流按谁计数 |
| `allowLoopbackSetup` | `false` | 允许回环地址免初始化口令直接设置密码 |
| `indexHtml` | `""` | 手动指定前端 `index.html` 路径（一般不用） |
| `unlockRemoteSettings` | `true` | 让远程浏览器也能用 Harness 的 host 侧设置，见下 |
| `pageTheme` | `"auto"` | 登录页配色：`auto`（跟随系统）/ `light` / `dark` |

### 关于 `unlockRemoteSettings`

Harness 默认只让**回环（本机）**浏览器读写「host 侧设置」。远程访问时设置页会显示 `settings are unavailable in this browser`，而且那个欢迎提示每次刷新都会回来。

本插件开启这项后，**已经过了密码门**的远程浏览器会被当作本机，设置页正常工作。不想要这个行为就设成 `false`。

## 排障

**登录成功了，但所有接口都 403。**

最常见的问题：Harness 的 Host/Origin 栅栏不认识你访问用的主机。插件在第一次遇到时会打印**该加什么参数**，同时给浏览器一个写明「Harness 看到的 Host 是什么」的诊断页：

```
dsh web-login: audit fence-rejected host=harness.example result=403
dsh web-login: 1) 给 dsh 声明这个主机（systemd 的 ExecStart 里加参数）：
dsh web-login:      --trusted-host harness.example
dsh web-login: 2) 让反向代理透传真实 Host 与 Origin：
dsh web-login:      proxy_set_header Host   $http_host;
dsh web-login:      proxy_set_header Origin $http_origin;
```

**忘记密码（连旧密码也想不起来）。** 停服务，编辑 `$DSH_HOME/.credentials.yaml`，删掉 `dsh-web-login/state` 那一段，重启。下次打开会重新进入首次设置：

```yaml
dsh-web-login/state:        # ← 连下面几行一起删
  kind: grant
  payload:
    version: 1
    algorithm: scrypt
```

**看审计日志：**

```bash
journalctl -u dsh --no-pager | grep 'dsh web-login: audit'
```

事件有 `password-set`、`login-ok`、`login-failed`、`password-changed`、`password-change-failed`、`password-reset`、`reset-failed`、`setup-token-failed`、`lockout`、`logout`、`fence-rejected`、`api-cross-origin-rejected`。失败行会带上累计次数，便于事后发现爆破。

## 安全说明

**挡得住**：扫描器、僵尸网络、拿到 URL 但不在你网络链路上的陌生人。他们看到的是登录页，`/api` 也调不动。

**挡不住链路上的窃听者**：明文 HTTP 下密码和 cookie 都是裸奔的。这不是插件的问题，是明文 HTTP 的固有问题。如果条件允许，**SSH 隧道比暴露端口好得多**，而且不需要域名和证书：

```bash
ssh -N -L 3080:127.0.0.1:3080 user@你的服务器
# 然后本地打开 http://127.0.0.1:3080/
```

此时端口根本没开到公网，本插件仍然照常工作（多一道密码）。Tailscale / WireGuard 这类私有网络同理。

其它已知边界：

- 密码用 scrypt（N=16384, r=8, p=1）加盐哈希，存在 `$DSH_HOME/.credentials.yaml`（0600 权限）
- 登录态 cookie 为 HMAC-SHA256 签名并绑定 authority，换 host 或伪造都无效
- 限流按来源 IP 记在**内存**里，重启清零。它防的是单个来源的暴力破解，不防分布式慢速爆破 —— 但所有失败都会进审计日志
- 改密码会轮换签名密钥，因此其它设备上的登录态立即失效
- 这个插件拥有宿主进程的全部权限。请只使用你读过的版本，不要从不明来源安装同名的包

## 开发

```bash
npm test        # node:test，零依赖
```

覆盖密码哈希与校验、cookie 签名（含重放、篡改、跨 authority、过期）、限流与锁定隔离、authority 归一化、配置校验，以及浏览器半边的模块封装、slot 注册形状和渲染内容。

浏览器半边（`client.js`）是手写的 `window.__ModuleLoader__.load` 封装，**不需要打包器**，运行时只 `require("react")`。

## 兼容性

| dsh 版本 | 状态 |
|---|---|
| `0.2.0-rc.2` | 线上验证（Linux + nginx） |
| `0.1.2-rc.1` | 开发与测试（macOS） |

依赖的 Harness 公开 Service 只有三个：`connection.authorizeIndex()`、`connection.authenticatedUrl()`、`connection.requestRejection()`，加上 `webServer` 的 exact 路由注册与 `credentials` 的记录读写。

## License

MIT
