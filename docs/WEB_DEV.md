# Web 开发工作台

Web 与 Electron 复用 `src/renderer` 的全部 React 页面、组件和样式；`src/shared/bridge.ts` 是共用的已校验 RPC 桥接，只有宿主通信与少量能力不同。CLI 和桌面启动入口不变。

## 启动

```sh
pnpm dev:web --host 192.168.8.108 --port 5173 --workspace /home/ling/services/desktop-harness
```

请替换成本机实际局域网 IPv4 和项目目录。不传参数时只监听 `127.0.0.1:5173`，工作区为当前目录。必须指定单个 IPv4，不能用 `0.0.0.0`。服务启动后打印访问地址，浏览器直接打开即可，**不需要访问密码或登录**。

运行时使用现有 Harness 默认配置与存储（尊重 `FORGE_HOME`），API 密钥留在 Node 后端，不发送回浏览器。没有配置模型时，在共享设置页配置。Web 会话列表仅显示启动工作区，会话操作也会检查其工作区。目录选择按钮返回固定的服务器工作区，不是浏览器所在机器的目录；桌面文件导出在 Web 中禁用。

- renderer 的 React/CSS 由 Vite 热更新，无需编译或重开 Electron。
- 共享核心、Web 后端与启动脚本修改后，需要结束当前任务并重启此命令；不会在代理改代码时自动重启后端。
- Vite 热更新只更新界面，旧后端不会因此获得新存储格式的支持。更新来源配置或会话存储代码时，必须同时更新后端；不能让旧后端继续读取新版 CLI 已写入的数据。
- 多个页面可以同时连接，各自维护连接标识、事件游标和心跳，新页面不会使其他页面失效。刷新、切后台或网络断开不会取消任务；任务由后端持有，重新连接会恢复运行标识、当前输出、权限与未处理审批。断线期间审批继续等待，不自动批准。主动停止或关闭/重启后端仍会取消运行。
- HTTP/RPC 操作失败不会自动重放。执行中的模型生成请求遇到协议错误、网络故障、超时或 HTTP 408/429/5xx 时，在同一模型和来源下最多额外重试 5 次，退避为 0.5/1/2/4/8 秒；取消会立即中止等待。失败尝试的临时文字和思考会先清除，已完成的工具和整轮任务不重放。鉴权、观察回调和其他非 Provider 错误不自动重试。重试也不能保证绕过上游输出长度限制；`output_truncated` 表示上游以 `finish_reason: length` 截断，不能当成完整结果使用。
- 模型输出、工具进度和审批事件通过 `/api/events` WebSocket 即时推送，使用顺序编号和接收确认，不再每 300ms 轮询。普通 RPC 操作仍使用 HTTP POST。
- WebSocket 每 5 秒进行协议心跳，约 20 秒没有存活确认只断开该页面的连接，任务继续执行。客户端从 0.5 秒起退避重连，最长间隔 10 秒；恢复前台或网络时及时唤醒重连，按原游标补收事件，不自动重放操作。页面连接确实过期时提示重新连接。事件缓存已过期时自动重新加载页面，通过运行快照恢复。Vite HMR 使用另一条独立连接。
- 共享事件历史最多保留最近 5000 条或 8 MiB，单个页面的接收确认不会删除其他页面待补收的事件；超限仅淘汰最旧事件。发送积压只断开对应慢连接。刷新通过后端运行快照恢复，已保存的历史从会话加载，当前文字/思考分别保留最多 131072 字符，与界面显示上限一致。

### 旧会话迁移

先确认没有活动运行，并暂停或停止使用该数据目录的宿主，再执行显式迁移：

```sh
pnpm exec esbuild scripts/migrate-session-storage.ts --bundle --platform=node --format=esm --packages=external --outfile=.build/migrate-session-storage.mjs
node .build/migrate-session-storage.mjs --home /absolute/path/to/forge-state --apply
```

工具锁住设置和各个会话，在 `storage-migration-backups/<UUID>/` 保留原始会话与设置副本并落盘，然后将旧快照转换为当前格式、生成摘要索引，逐条比较转换前后的完整会话。历史消息、状态、模型、时间与配置不变，不推测旧会话原先的模型来源，不重放任何任务。完成后启动当前源码后端。备份保留，不自动删除。

## 图片输入

输入框左下角的图片图标可选择多张图片，也支持把剪贴板中的图片粘贴到输入框。
每条消息最多 4 张，单张不超过 2 MiB，支持 PNG、JPEG、WebP、GIF。
缩略图和错误提示位于输入框上方，可以删除附件，也可以只发送图片。
图片随消息保存；点击历史缩略图可在当前页面查看原图。

运行中仍使用 Enter 排队、Alt+Enter 插话，图片与文字一起传递。
发送失败时保留当前草稿；待发图片无法写入浏览器存储时拒绝入队并保留附件。
尚未发送的图片只保存在当前页面内存，刷新或关闭页面后需要重新选择。
所选模型需要支持图片输入；图片按对应 API 的原生图片内容发送，不转换成文字。
后端需要包含图片协议支持，仅热更新 renderer 不足以启用图片发送。

## HTML 预览

Web 工作台可以把两类 HTML 渲染成真实页面：会话中围栏标记为 `html`/`htm`/`xhtml` 的代码块，以及文件变更中路径以 `.html`/`.htm` 结尾的文件（删除的变更不提供预览）。代码块右上角的「预览」按钮与差异卡片标题栏的「预览 HTML」按钮会打开预览对话框。

- 预览文档由后端单独返回（`POST /api/preview`、`POST /api/preview/file` 取得一次性 URL，`GET /preview/document?id=…` 返回内容），和主页面同源，无需认证 cookie；URL 中的 id 为 24 字节随机值，保留最近 24 个文档、30 分钟、合计 8 MiB。
- 预览文档只以 `sandbox="allow-scripts"` 嵌入（没有 `allow-same-origin`），所以脚本在预览内运行，但读不到工作台 DOM、cookie 或工作区文件；文档 CSP 为 `default-src 'none'`、`connect-src 'none'`、`form-action 'none'`，图片/字体/媒体只允许 `data:`/`blob:`，无法访问网络。`X-Frame-Options` 仅对这个端点放宽为 `SAMEORIGIN`，工作台其余页面仍是 `DENY`。
- 文件预览只读取工作区内、非符号链接、非隐藏路径（`.git`、`.env*` 等一律拒绝）、UTF-8、不超过 1 MiB 的 `.html`/`.htm` 文件；这是读取文件的快捷方式，不会写入或执行工作区内容。
- 该能力依赖 Web 后端端点，桌面 Electron 宿主没有对应实现，因此共享 renderer 在桌面端不显示预览按钮。修改后端或共享契约后需要重启 `pnpm dev:web`；只改 renderer 时热更新即可。

## 访问边界

这是可信局域网中的单用户 **无密码 HTTP 开发入口**，不是公网部署方案、多租户服务或 OS 沙箱。任何能访问此地址的人都能使用工作台，包括配置 Provider/MCP 和批准命令；会话、代码等在 HTTP 网络上传输，没有 TLS 加密。不要端口转发到公网，不要在不可信网络使用。

HTTP API 仍校验精确 Host/Origin、JSON POST 和已登记的页面标识；事件 WebSocket 校验 Host/Origin、页面标识和事件游标，不再要求登录 cookie。HMR WebSocket 保留 Vite 自身的 token 校验，无需用户输入。只有 Web dev 的 HTML 放宽 CSP 以支持 HMR，桌面生产 HTML 的 CSP 不变；HTML 预览文档有独立的严格 CSP，并只在无 `allow-same-origin` 的沙箱中嵌入。固定工作区不把命令变成沙箱。

## 聚焦检查

```sh
pnpm exec vitest run tests/web-host.test.ts tests/web-bridge.test.ts tests/web-socket-browser.test.ts tests/renderer/html-preview.test.ts tests/renderer/html-preview-mounted.test.ts
```

浏览器冒烟必须先使用临时 `FORGE_HOME` 启动独立 dev 服务，避免读取真实配置或改动用户会话，然后运行：

```sh
node scripts/check-web-dev.mjs http://192.168.8.108:5174
```

此脚本使用本机 `/usr/bin/google-chrome-stable`，验证免登录进入、共享界面、HMR socket、桥接会话 CRUD 和刷新握手，不调用外部模型；会在临时存储中创建一个 fixture 会话。结束后停止临时服务并删除临时 `FORGE_HOME`。单元测试另用 fixture provider 验证真实 Harness 运行与事件传输，不代表真实 Provider 或所有工具均已端到端验收。
