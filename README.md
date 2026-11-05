# dsh-extension

给 [dsh web](https://github.com/deepseek-ai) 侧栏加一个「**拓展**」面板：查看并一键重启本机 **bsk**（浏览器扩展守护进程）。

它解决的问题很具体 —— bsk daemon 掉线或协议不兼容时，以前得开终端敲 `bsk daemon stop` / `bsk daemon start`，现在侧栏点一下，约 1.5 秒完成，状态实时回显。

```
侧栏
├── …
├── 自动化任务
└── 拓展          ← 本插件（order 11，紧跟「自动化任务」）
     └── ▼ 浏览器扩展（bsk）   运行中 · 已连接浏览器
           :52800 · v0.4.1
           日志：browser connected（chrome）
           [ 重启 bsk ]  [ 刷新状态 ]
```

## 功能

| 功能 | 说明 |
|---|---|
| **状态常驻** | 侧栏折叠头上一眼看到 `运行中 / 未连接 / 未运行`，展开后有端口、版本、连接证据（取自 bsk 日志） |
| **一键重启** | `daemon stop --quiet` → 等端口释放 → 清残留 `daemon.json`/`daemon.lock` → `daemon start --foreground` → 等 52800 就绪，返回**每一步耗时** |
| **折叠分组** | 面板内可折叠，状态记忆在 `localStorage`，刷新后保持 |
| **协议体检** | 读 daemon 日志判断协议版本是否低于对端要求；只对「最近一次连接之后」的踢人记录告警，升级 bsk 后不会残留假警报 |
| **零依赖** | 只用 Node 内置模块（`fs` / `net` / `child_process`），不装任何 npm 包 |
| **优雅降级** | 面板注册失败只打 `console.warn`，不会把整包 dsh 客户端 UI 拖成 pending |

## 安装

```bash
# 1) 放进 dsh 的插件目录
git clone https://github.com/<你的账号>/dsh-extension.git \
  "$HOME/.dsh/plugins/dsh-extension"

# 2) 装进 web profile（file: 指向本地目录）
dsh plugin --profile web add "file:$HOME/.dsh/plugins/dsh-extension"

# 3) 重启 dsh web（或直接重启 dsh）
```

Windows PowerShell：

```powershell
git clone https://github.com/<你的账号>/dsh-extension.git "$env:USERPROFILE\.dsh\plugins\dsh-extension"
dsh plugin --profile web add "file:$env:USERPROFILE\.dsh\plugins\dsh-extension"
```

装完打开 dsh web，侧栏「自动化任务」下面就是「拓展」。

卸载：

```bash
dsh plugin --profile web remove dsh-extension
```

## 使用

1. 点侧栏「拓展」。折叠头右侧的胶囊就是当前状态。
2. 展开分组，能看到 bsk 版本、端口和一条「证据」——它是从 `~/.bsk/daemon.log.YYYY-MM-DD` 里取的最后一次 `browser connected` / `disconnected` 记录。
3. 浏览器扩展抽风、连接不上时，点「重启 bsk」。下方会逐步打印耗时：

```
   12ms  daemon 在运行，先停止
  380ms  stop 退出码 0
  981ms  start 已投递（pid 48212）
 1466ms  端口 52800 已就绪
```

4. 失败时的常见原因：`bsk.exe` 不在默认路径（用 `BSK_PATH` 指定），或 daemon 端口被别的进程占用。

## 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `BSK_PATH` | `~/.local/bin/bsk.exe` | bsk 可执行文件位置 |
| `BSK_HOME` | `~/.bsk` | bsk 数据目录（日志、`daemon.json`） |

## HTTP 接口

宿主端注册了两个同源接口（需要 dsh web 的登录态）：

```http
GET  /__dsh-start/ext/bsk/status
→ { "ok": true, "data": { "installed": true, "running": true, "port": 52800,
                          "version": "0.4.1", "connected": true,
                          "evidence": "日志：browser connected（chrome）",
                          "browser": "chrome", "protocolWarning": null } }

POST /__dsh-start/ext/bsk/restart
→ { "ok": true, "data": { "ok": true, "ms": 1466, "message": "bsk 已重启",
                          "steps": [{ "t": 12, "text": "…" }], "status": { … } } }
```

## 目录结构

```
dsh-extension/
├── package.json          # name / dsh.client / dsh.bundle 声明
├── cordis.patch.yml      # bundle 层：往 profile 里插入一行 entry
├── locale/
│   ├── zh.json           # 插件管理页显示名：拓展
│   └── en.json
└── src/
    ├── index.js          # 宿主端：HTTP 路由、bsk 进程管理、日志解析
    └── client.js         # 浏览器端：侧栏条目 + 面板（React.createElement）
```

## 兼容性

- dsh `0.2.x`（`sidebar.panellist` / `slots` 这套 API）
- Node.js ≥ 20
- 仅 Windows 验证过（依赖 `bsk.exe` 与 `daemon stop/start` 语义）

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| 侧栏没有「拓展」 | 刷新页面（`Ctrl+F5`）；仍没有就看 `dsh` 启动日志有没有 `import failed` |
| 日志报 `loaded without registering "dsh-extension"` | `src/client.js` 里 `__ModuleLoader__.load({ id })` 必须**等于** `package.json` 的 `name`，两者不一致就会被判成「加载了但没注册」 |
| 点重启没反应 | 面板会显示错误原因；先在终端跑一次 `bsk daemon start` 确认 bsk 本身可用 |
| 一直提示「协议不兼容」 | 本机 bsk 版本低于浏览器扩展要求，升级：`bsk update -y`（必要时带 `HTTPS_PROXY`） |

## License

[MIT](LICENSE)
