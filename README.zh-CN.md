# dsh-web-login

中文 · [English](README.md)

DeepSeek Harness Web GUI 的独立密码验证层。

零运行时依赖的 Cordis 插件。接管 `/` 与 `/index.html`：未通过验证的请求不会转发至 Harness，启动 token 亦不下发。Harness 自身的鉴权逻辑与 `/api/*` 不受影响。

![登录页](docs/login.png)

## 特性

- **首次设置**：首次访问时设置密码，以启动日志中的一次性口令校验，防止公网抢先初始化
- **登录态**：「记住我」默认 30 天，否则默认 12 小时，均可配置
- **失败锁定**：同一来源连续失败 5 次后锁定 300 秒，按真实客户端 IP 计数
- **审计日志**：记录登录、改密、锁定与退出事件，不含密码内容
- **管理界面**：集成于 Harness 设置，提供修改密码、重置密码与退出登录
- **凭据存储**：密码经 scrypt 加盐哈希；登录态 Cookie 经 HMAC-SHA256 签名并绑定主机

## 安装

前置条件：pnpm。dsh 不内置 pnpm；缺失时安装命令以 `pnpm was not found` 失败，且不改动 profile。

```bash
npm i -g pnpm
dsh plugin --profile web add git+https://github.com/liyang52520/dsh-web-login.git
```

本包声明 `dsh.bundle`，安装后由 dsh 自动注册至 `dsh.profile.bundles`，无需手工编辑配置。

重启 dsh 以加载插件；systemd 部署使用 `systemctl restart dsh`。

维护命令：

```bash
dsh plugin --profile web update dsh-web-login    # 升级
dsh plugin --profile web remove dsh-web-login    # 卸载
```

`DSH_HOME` 须与运行中实例一致（默认 `~/.dsh`）。路径不一致时命令仍返回成功，但插件将安装至其它 profile，对当前实例不生效。

<details>
<summary>手动安装（不使用 dsh plugin）</summary>

经 pnpm 安装：

```bash
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
pnpm add 'github:liyang52520/dsh-web-login'

grep -q web-login cordis.patch.yml 2>/dev/null || cat >> cordis.patch.yml <<'EOF'
- insert:
    - id: web-login
      name: dsh-web-login
EOF
```

不使用 pnpm 时，改为复制受版本控制的文件，并写入同上 `insert` 段：

```bash
git clone https://github.com/liyang52520/dsh-web-login.git /opt/dsh-web-login
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
mkdir -p "$PROFILE/node_modules/dsh-web-login"
git -C /opt/dsh-web-login archive HEAD | tar -x -C "$PROFILE/node_modules/dsh-web-login"
```

两种挂载方式不可混用：bundle 与 `insert` 各产生一行 `web-login`，重复 id 将导致配置树加载失败。

</details>

## 使用

### 首次设置

dsh 启动时输出一次性初始化口令：

```
dsh web-login: setup-token: 7rJfiimRBtBZbZZqbEY3_O6VBO3Te-bA
```

检索方式依部署而定：systemd 使用 `journalctl -u dsh`，前台运行见终端输出，容器使用 `docker logs`。

访问站点，输入该口令并设置密码。

### 管理界面

登录后进入 Harness 的 **设置 → 登录门禁**：

![设置页](docs/settings.jpg)

| 操作 | 说明 |
|---|---|
| 修改密码 | 验证当前密码后设置新密码；轮换签名密钥，其它设备登录态失效 |
| 重置密码 | 删除密码记录，所有设备需重新执行首次设置 |
| 退出登录 | 仅清除当前设备的登录态 |

界面配色跟随 Harness 的主题设置。

![深色主题](docs/settings-dark.jpg)

## 配置

配置项写入 profile 的 `cordis.patch.yml`：

```yaml
- id: web-login
  config:
    title: 我的 Harness
    rememberDays: 7
```

`config` 为整体替换；未列出的键使用默认值。

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
| `unlockRemoteSettings` | `true` | 允许远程浏览器修改设置，参见「设置页只读」 |
| `pageTheme` | `"auto"` | 登录页配色：`auto` / `light` / `dark` |

## 排障

### 登录成功，接口返回 403

Harness 的 Host/Origin 校验不包含访问所使用的主机名。插件首次检测到该情况时，将在输出中给出所需配置，并在页面显示 Harness 实际收到的 Host：

```
dsh web-login: 1) 给 dsh 声明这个主机：--trusted-host harness.example
dsh web-login: 2) 让反向代理透传真实 Host 与 Origin：
dsh web-login:      proxy_set_header Host   $http_host;
dsh web-login:      proxy_set_header Origin $http_origin;
```

第 1 步为必需；第 2 步仅适用于经反向代理访问的场景。

### 设置页只读，提示 settings are unavailable in this browser

Harness 仅允许本机浏览器修改设置。经回环地址或 SSH 隧道访问属本机；经反向代理自公网访问则不属，此时设置页只读并显示上述提示，页面顶部的欢迎说明亦会在每次刷新后重新出现。

本插件默认将已通过密码验证的远程浏览器视为本机（`unlockRemoteSettings: true`），设置页可正常使用。如不需该行为，设为 `false`。

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

审计记录输出至 dsh 的标准输出，每行以 `dsh web-login: audit` 开头。systemd 部署下：

```bash
journalctl -u dsh --no-pager | grep 'dsh web-login: audit'
```

事件类型：`password-set`、`login-ok`、`login-failed`、`password-changed`、`password-change-failed`、`password-reset`、`reset-failed`、`setup-token-failed`、`lockout`、`logout`、`fence-rejected`、`api-cross-origin-rejected`。失败事件附带累计次数。

## 安全说明

**可防御**：扫描器、僵尸网络，以及获取 URL 但不在网络链路上的第三方。此类访问仅能看到登录页，且无法调用 `/api`。

**不可防御链路上的窃听者**：明文 HTTP 下密码与 Cookie 均以明文传输，属协议固有限制，非本插件所致。条件允许时应以 SSH 隧道替代直接暴露端口，且无需域名与证书：

```bash
ssh -N -L 3080:127.0.0.1:3080 user@<服务器地址>
# 本地访问 http://127.0.0.1:3080/
```

此时端口未对公网开放，本插件仍正常工作。其它已知边界：

- 密码经 scrypt（N=16384, r=8, p=1）加盐哈希，存储于 `$DSH_HOME/.credentials.yaml`，权限 0600
- 登录态 Cookie 经 HMAC-SHA256 签名并绑定访问所使用的主机，换用其它主机名访问或伪造 Cookie 均无效
- 限流记录保存于内存，重启后清零；可防御单来源暴力破解，不防御分布式慢速爆破，但所有失败均写入审计日志
- 修改密码将轮换签名密钥，其它设备登录态随即失效
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
