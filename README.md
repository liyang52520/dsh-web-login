# dsh-web-login

为 DeepSeek Harness Web GUI 提供独立的密码验证层。

零运行时依赖的 Cordis 插件。接管 `/` 与 `/index.html`，未通过验证时不向 Harness 转发启动 token；不改动 Harness 自身的鉴权逻辑，不涉及 `/api/*`。

![登录页](docs/login.png)

## 特性

- **首次设置**：首次访问引导设置密码，以启动时打印的一次性口令校验，避免公网扫描器抢先初始化
- **登录态管理**：勾选「记住我」默认 30 天，否则默认 12 小时，均可配置
- **失败锁定**：同一来源连续失败 5 次后锁定 300 秒，按真实客户端 IP 计数
- **审计日志**：记录登录成功与失败、改密、锁定、退出，且不记录密码内容
- **管理界面**：集成在 Harness 设置中，提供修改密码、重置密码、退出登录
- **凭据安全**：密码以 scrypt 加盐哈希存储；登录态 Cookie 使用 HMAC-SHA256 签名，并绑定访问时使用的主机

## 安装

要求 pnpm，未安装时执行 `npm i -g pnpm`。

```bash
dsh plugin --profile web add git+https://github.com/liyang52520/dsh-web-login.git
```

插件声明了 `dsh.bundle`，因此 `dsh plugin add` 会自动写入 `dsh.profile.bundles` 并安装依赖，无需手工编辑配置文件。

之后重启 dsh 使插件生效。用 systemd 时是 `systemctl restart dsh`，其它部署方式重启对应进程即可。

后续维护：

```bash
dsh plugin --profile web update dsh-web-login    # 升级
dsh plugin --profile web remove dsh-web-login    # 卸载
```

> **注意 `DSH_HOME`。** 该命令按 `$DSH_HOME`（默认 `~/.dsh`）确定目标 profile。若指定的路径与运行中实例不一致，命令仍会成功，但插件会安装到另一个 profile，对当前实例不生效。

<details>
<summary>不使用 dsh plugin 的手动安装</summary>

使用 pnpm：

```bash
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
pnpm add 'github:liyang52520/dsh-web-login'

grep -q web-login cordis.patch.yml 2>/dev/null || cat >> cordis.patch.yml <<'EOF'
- insert:
    - id: web-login
      name: dsh-web-login
EOF
```

然后重启 dsh。

不使用 pnpm 时，改为复制受版本控制的文件，并写入上面同一段 `insert`：

```bash
git clone https://github.com/liyang52520/dsh-web-login.git /opt/dsh-web-login
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
mkdir -p "$PROFILE/node_modules/dsh-web-login"
git -C /opt/dsh-web-login archive HEAD | tar -x -C "$PROFILE/node_modules/dsh-web-login"
```

手动安装与 `dsh plugin` 不可混用：两种挂载方式会各产生一行 `web-login`，重复 id 会导致配置树加载失败。

</details>

## 使用

### 首次设置

dsh 启动时会把一次性初始化口令打印到自己的输出里：

```
dsh web-login: setup-token: 7rJfiimRBtBZbZZqbEY3_O6VBO3Te-bA
```

在你启动 dsh 的地方查找这一行 —— systemd 用 `journalctl -u dsh`，直接运行看终端输出，容器用 `docker logs`。

访问站点，输入该口令并设置密码。

### 管理界面

登录后在 Harness 的 **设置 → 登录门禁** 中管理：

![设置页](docs/settings.jpg)

| 操作 | 说明 |
|---|---|
| 修改密码 | 验证当前密码后设置新密码；同时轮换签名密钥，其它设备的登录态立即失效 |
| 重置密码 | 删除密码记录，所有设备需重新执行首次设置 |
| 退出登录 | 仅清除当前设备的登录态 |

界面跟随 Harness 的主题设置。

![深色主题](docs/settings-dark.jpg)

## 配置

配置写入 profile 的 `cordis.patch.yml`：

```yaml
- id: web-login
  config:
    title: 我的 Harness
    rememberDays: 7
```

`config` 为整体替换，未列出的键使用默认值。

| 键 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 设为 `false` 时不接管任何路由 |
| `title` | `"DeepSeek Harness"` | 页面标题与登录页标题 |
| `passwordMinLength` | `8` | 密码最短长度 |
| `rememberDays` | `30` | 勾选「记住我」时的登录态天数 |
| `sessionHours` | `12` | 未勾选时的登录态小时数 |
| `maxFailures` | `5` | 连续失败多少次后锁定 |
| `lockoutSeconds` | `300` | 锁定时长（秒） |
| `clientIpHeader` | `"x-real-ip"` | 用于获取真实客户端 IP 的请求头，决定限流计数对象 |
| `allowLoopbackSetup` | `false` | 允许回环地址在无初始化口令的情况下设置密码 |
| `indexHtml` | `""` | 手动指定前端 `index.html` 路径 |
| `unlockRemoteSettings` | `true` | 让远程浏览器也能修改设置，见「设置页只读」 |
| `pageTheme` | `"auto"` | 登录页配色：`auto` / `light` / `dark` |

## 排障

### 登录成功，但所有接口返回 403

Harness 的 Host/Origin 校验未包含你访问时使用的主机名。插件首次遇到该情况时会输出所需操作，并在页面上显示 Harness 实际收到的 Host：

```
dsh web-login: 1) 给 dsh 声明这个主机：--trusted-host harness.example
dsh web-login: 2) 让反向代理透传真实 Host 与 Origin：
dsh web-login:      proxy_set_header Host   $http_host;
dsh web-login:      proxy_set_header Origin $http_origin;
```

第 1 步无论如何都要做；第 2 步仅在经反向代理访问时需要。

### 设置页只读，提示 settings are unavailable in this browser

Harness 只允许**本机**浏览器修改设置：通过回环地址或 SSH 隧道访问算本机，经反向代理从公网访问不算。所以远程访问时设置页只读，并显示这行提示；页面顶部的欢迎说明也会每次刷新重新出现。

本插件默认把**已通过密码验证**的远程浏览器当作本机（`unlockRemoteSettings: true`），使设置页恢复正常。若不需要该行为，将其设为 `false`。

### 忘记密码

停止服务，删除 `$DSH_HOME/.credentials.yaml` 中的 `dsh-web-login/state` 段，重启后重新执行首次设置：

```yaml
dsh-web-login/state:        # 连同下方内容一并删除
  kind: grant
  payload:
    version: 1
    algorithm: scrypt
```

### 审计日志

审计记录同样输出到 dsh 的标准输出，每行以 `dsh web-login: audit` 开头。systemd 部署下：

```bash
journalctl -u dsh --no-pager | grep 'dsh web-login: audit'
```

事件类型：`password-set`、`login-ok`、`login-failed`、`password-changed`、`password-change-failed`、`password-reset`、`reset-failed`、`setup-token-failed`、`lockout`、`logout`、`fence-rejected`、`api-cross-origin-rejected`。失败事件会附带累计次数。

## 安全说明

**可防御**：扫描器、僵尸网络，以及获取到 URL 但不在网络链路上的第三方。此类访问只能看到登录页，且无法调用 `/api`。

**不可防御链路上的窃听者**：明文 HTTP 下密码与 Cookie 均以明文传输，这是协议本身的限制而非本插件的问题。条件允许时应优先使用 SSH 隧道而非直接暴露端口，且无需域名与证书：

```bash
ssh -N -L 3080:127.0.0.1:3080 user@你的服务器
# 本地访问 http://127.0.0.1:3080/
```

此时端口未对公网开放，本插件仍正常工作。其它已知边界：

- 密码使用 scrypt（N=16384, r=8, p=1）加盐哈希，存储于 `$DSH_HOME/.credentials.yaml`，权限 0600
- 登录态 Cookie 使用 HMAC-SHA256 签名并绑定访问时使用的主机，换用其它主机名访问或伪造 Cookie 均无效
- 限流记录保存在内存中，重启后清零；可防御单来源暴力破解，不防御分布式慢速爆破，但所有失败都会写入审计日志
- 修改密码会轮换签名密钥，其它设备的登录态立即失效
- 插件拥有宿主进程的完整权限，请仅使用经过审阅的版本

## 开发

```bash
npm test        # node:test，零依赖
```

覆盖密码哈希与校验、Cookie 签名（重放、篡改、跨主机、过期）、限流与锁定隔离、主机名归一化、配置校验，以及浏览器半边的模块封装、slot 注册与渲染结果。

浏览器半边 `client.js` 为手写的 `window.__ModuleLoader__.load` 封装，无需打包器，运行时仅 `require("react")`。

## 兼容性

| dsh 版本 | 状态 |
|---|---|
| `0.2.0-rc.2` | 线上验证（Linux + nginx） |
| `0.1.2-rc.1` | 开发与测试（macOS） |

依赖的 Harness 公开 Service 为 `connection.authorizeIndex()`、`connection.authenticatedUrl()`、`connection.requestRejection()`，以及 `webServer` 的 exact 路由注册与 `credentials` 的记录读写。

## License

MIT © liyang52520
