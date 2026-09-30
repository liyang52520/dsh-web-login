# dsh-web-login

给 **DeepSeek Harness** 的 Web 界面加一道密码门。零依赖 Cordis 插件，不碰 `/api`，不改动 Harness 自身的鉴权。

![登录页](docs/login.png)

## 为什么需要

把 `dsh web` 反代到公网，直接访问只会得到：

> dsh web authentication required; reopen the URL printed by dsh web.

Harness 的凭证是启动时打印的一次性 token URL —— 进了日志、聊天记录就等于泄露。本插件在它前面加一道自己的密码，**没过密码连 token 都拿不到**。

## 长什么样

登录后，管理入口就在 **Harness 设置 → 登录门禁**：

![设置页](docs/settings.jpg)

| 操作 | 作用 |
|---|---|
| **修改密码** | 旧密码换新密码，其它设备立即掉线 |
| **重置密码** | 删掉密码记录，重新走首次设置 |
| **退出登录** | 只清掉这台设备 |

配色自动跟随 Harness 主题：

![深色](docs/settings-dark.jpg)

## 安装

需要 pnpm（没有就 `npm i -g pnpm`）。复制粘贴：

```bash
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web"
pnpm add 'github:liyang52520/dsh-web-login'

grep -q web-login cordis.patch.yml 2>/dev/null || cat >> cordis.patch.yml <<'EOF'
- insert:
    - id: web-login
      name: dsh-web-login
EOF

systemctl restart dsh
```

升级 = 重跑 `pnpm add` + 重启。

## 使用

首次打开页面，初始化口令在日志里：

```bash
journalctl -u dsh | grep 'dsh web-login'
```

```
dsh web-login: setup-token: 7rJfiimRBtBZbZZqbEY3_O6VBO3Te-bA
```

填口令 → 设置密码 → 进入。之后都在设置页里管理。

## 配置

```yaml
- id: web-login
  config:
    title: 我的 Harness
    rememberDays: 7
```

<details>
<summary>全部配置项</summary>

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 设 `false` 则完全不接管路由 |
| `title` | `"DeepSeek Harness"` | 页面与登录页标题 |
| `passwordMinLength` | `8` | 密码最短长度 |
| `rememberDays` | `30` | 勾「记住我」时的登录态天数 |
| `sessionHours` | `12` | 不勾时的登录态小时数 |
| `maxFailures` | `5` | 连续失败几次后锁定 |
| `lockoutSeconds` | `300` | 锁定时长（秒） |
| `clientIpHeader` | `"x-real-ip"` | 从哪个头取真实客户端 IP |
| `allowLoopbackSetup` | `false` | 回环地址免初始化口令 |
| `indexHtml` | `""` | 手动指定前端 `index.html` 路径 |
| `unlockRemoteSettings` | `true` | 让远程也能用 Harness 的 host 侧设置 |
| `pageTheme` | `"auto"` | 登录页配色：`auto` / `light` / `dark` |

`config` 是**整块替换**，写几个生效几个。

**`unlockRemoteSettings`**：Harness 默认只让本机浏览器读写 host 侧设置，远程会看到 `settings are unavailable in this browser`。开启后，**已过密码门**的远程浏览器被当作本机。不想要就设 `false`。

</details>

<details>
<summary>其它安装方式</summary>

**用官方的 `dsh plugin`**（本包声明了 `dsh.bundle`，它本该自动写入 `dsh.profile.bundles`，不需要手写 `insert`）：

```bash
dsh plugin --profile web add git+https://github.com/liyang52520/dsh-web-login.git
```

> ⚠️ 注意 `DSH_HOME`。这条命令按 `$DSH_HOME`（默认 `~/.dsh`）决定操作哪个 profile；传错了它会**安静地在另一个路径新建 profile 并装好**，pnpm 报成功、退出码 0，但线上毫无变化。

**不用 pnpm**：

```bash
git clone https://github.com/liyang52520/dsh-web-login.git /opt/dsh-web-login
PROFILE="${DSH_HOME:-$HOME/.dsh}/profiles/web"
mkdir -p "$PROFILE/node_modules/dsh-web-login"
git -C /opt/dsh-web-login archive HEAD | tar -x -C "$PROFILE/node_modules/dsh-web-login"
```

</details>

<details>
<summary>排障</summary>

**登录成功但所有接口 403。** Harness 的 Host/Origin 栅栏不认识你访问用的主机。插件第一次遇到时会打印该加什么：

```
dsh web-login: 1) 给 dsh 声明这个主机：--trusted-host harness.example
dsh web-login: 2) 让反向代理透传真实 Host 与 Origin：
dsh web-login:      proxy_set_header Host   $http_host;
dsh web-login:      proxy_set_header Origin $http_origin;
```

**忘记密码。** 停服务，删掉 `$DSH_HOME/.credentials.yaml` 里的 `dsh-web-login/state` 整段，重启后重新走首次设置。

**审计日志。** 每次登录成败、改密、锁定、退出都记一行，不含密码内容：

```bash
journalctl -u dsh --no-pager | grep 'dsh web-login: audit'
```

</details>

<details>
<summary>安全边界</summary>

**挡得住**：扫描器、僵尸网络、拿到 URL 但不在你链路上的陌生人。

**挡不住链路上的窃听者** —— 明文 HTTP 下密码和 cookie 都是裸奔的。有条件的话 **SSH 隧道比暴露端口好得多**，还不需要域名和证书：

```bash
ssh -N -L 3080:127.0.0.1:3080 user@你的服务器
# 本地打开 http://127.0.0.1:3080/
```

此时端口没开到公网，本插件仍照常工作。其它边界：

- 密码 scrypt（N=16384, r=8, p=1）加盐哈希，存在 `$DSH_HOME/.credentials.yaml`（0600）
- 登录态 cookie 为 HMAC-SHA256 签名并绑定 authority，换 host 或伪造无效
- 限流按来源 IP 记在**内存**里，重启清零；防单点爆破，不防分布式慢速爆破
- 改密码会轮换签名密钥，其它设备立即失效
- 插件拥有宿主进程全部权限，请只使用你读过的版本

</details>

<details>
<summary>开发</summary>

```bash
npm test        # node:test，零依赖
```

覆盖密码哈希、cookie 签名（重放/篡改/跨 authority/过期）、限流与锁定隔离、配置校验，以及浏览器半边的模块封装与渲染。

浏览器半边 `client.js` 是手写的 `window.__ModuleLoader__.load` 封装，**不需要打包器**，运行时只 `require("react")`。

</details>

---

MIT © liyang52520
