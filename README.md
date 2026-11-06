# dsh-extension

给 dsh web 侧栏加一行「拓展」（在「自动化任务」下面），点开是一个**小功能集合容器**。

它自己不带任何功能。功能由别的插件把卡片注册进来，容器统一负责：

- **分组折叠** —— 卡片可以落在分组里，分组和卡片都能折叠；折叠时卡片内容不挂载，后台轮询自然停掉
- **拖拽排序** —— 拖动卡片左侧的 ⠿ 手柄；也可以聚焦卡片后按 `Alt` + `↑` / `↓`
- **开关** —— 卡片右上角的开关是真的启用/停用**对应插件**（走 dsh 插件管理器的 `setPluginEnabled`），不是简单的隐藏
- **搜索** —— 中英文一起匹配；范围可切「全部 / 名称 / 简介」

状态（顺序、折叠、搜索范围、卡片快照）存在 `localStorage['dsh-extension.state.v1']`。

## 安装

```bash
"C:/Program Files/nodejs/node.exe" "C:/Users/<你>/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add file:<这个目录的绝对路径>
```

装完重启 dsh web。侧栏出现「拓展」即成功；面板是空的，因为还没有插件往里注册卡片。

## 给插件作者的注册契约

在 `apply(ctx)` 里拿到容器服务，把自己的卡片注册进去：

```js
const hub = ctx.get('extensionHub') || window.__DSH_EXTENSION_HUB__
if (hub) hub.register(item) // 返回 dispose
```

容器可能比你晚一步 apply，所以建议轮询几百毫秒再放弃。同一个对象也挂在
`window.__DSH_EXTENSION_HUB__` 上，作为 cordis 服务隔离时的兜底通道。

`item` 字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 卡片唯一 id |
| `name` | ✅ | `{ zh, en }`，卡片标题，同时参与搜索 |
| `desc` | | `{ zh, en }`，一行简介，同时参与搜索 |
| `group` | | `'browser'` 或 `{ id, name: { zh, en } }`；不填落「通用」 |
| `order` | | 同组内的初始排序权重，默认 0 |
| `pluginName` | | 该卡片所属的 dsh 包名。填了才会有真开关 |
| `icon` | | React 组件，接收 `{ size }` |
| `Badge` | | React 组件，渲染在卡片头右侧（状态胶囊），自己管轮询 |
| `Body` | | React 组件，卡片展开体。**只在展开时挂载**，适合放轮询 |

注意：`Body` / `Badge` 都是 React 组件，用 `require('react')` 的 `createElement` 写（前端 bundle 不支持 JSX）。

## 兼容性

- dsh `0.2.x`（在 0.2.2-rc.1 上验证）
- Node.js >= 20
- 需要 profile 提供插件管理接口（`remote.pluginManager`），否则开关会置灰并说明原因

## 已注册的插件

- [`dsh-bsk-daemon`](https://github.com/WoodenDrifter/dsh-bsk-daemon) —— 浏览器技能（bsk）的 daemon 管理

## License

MIT
