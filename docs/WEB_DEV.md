# Web 开发工作台

Web 与 Electron 复用 `src/renderer` 的全部 React 页面、组件和样式；`src/shared/bridge.ts` 是共用的已校验 RPC 桥接，只有宿主通信与少量能力不同。CLI 和桌面启动入口不变。

Android 扫码连接、桌面内开启的共享局域网核心，以及不依赖 Vite 的 `pnpm build:web` / `pnpm serve:web` 入口见 [Android 局域网客户端](ANDROID.md)。本文的 `dev:web` 提供开发热更新和多工作区支持；设置中的“手机连接”可以显示当前工作台地址二维码。

## 启动

```sh
pnpm dev:web --host 192.168.8.108 --port 5173 --workspace /home/ling/services/desktop-harness
```

请替换成本机实际局域网 IPv4 和项目目录。不传参数时只监听 `127.0.0.1:5173`，工作区为当前目录。必须指定单个 IPv4，不能用 `0.0.0.0`。服务启动后打印访问地址，浏览器打开或 Android 扫码即可直接接入，无需邀请码、设备授权或本机确认。无需 `--trusted-lan` 开关。

运行时使用现有 Harness 默认配置与存储（尊重 `FORGE_HOME`），API 密钥留在 Node 后端，不发送回浏览器。没有配置模型时，在共享设置页配置。`dev:web` 会话列表显示同一存储中的所有项目，可查看、操作其他工作区的会话。新任务的“服务器工作区”输入框可修改为服务器上的其他项目绝对路径；`--workspace` 只指定默认目录，不限制会话范围，路径不是浏览器所在机器的目录。正式 `serve:web` 仍限制到启动工作区，桌面文件导出在 Web 中禁用。

- renderer 的 React/CSS 由 Vite 热更新，无需编译或重开 Electron。
- 共享核心、Web 后端与启动脚本修改后，需要结束当前任务并重启此命令；不会在代理改代码时自动重启后端。
- Vite 热更新只更新界面，旧后端不会因此获得新存储格式的支持。更新来源配置或会话存储代码时，必须同时更新后端；不能让旧后端继续读取新版 CLI 已写入的数据。
- 多个页面可以同时连接，各自维护连接标识、事件游标和心跳，新页面不会使其他页面失效。刷新、切后台或网络断开不会取消任务；任务由后端持有，重新连接会恢复运行标识、当前输出、权限与未处理审批。断线期间审批继续等待，不自动批准。主动停止或关闭/重启后端仍会取消运行。
- HTTP/RPC 操作失败不会自动重放。执行中的模型生成请求遇到协议错误、网络故障、超时或 HTTP 408/429/5xx 时，在同一模型和来源下最多额外重试 5 次，退避为 0.5/1/2/4/8 秒；取消会立即中止等待。失败尝试的临时文字和思考会先清除，已完成的工具和整轮任务不重放。鉴权、观察回调和其他非 Provider 错误不自动重试。重试也不能保证绕过上游输出长度限制；`output_truncated` 表示上游以 `finish_reason: length` 截断，不能当成完整结果使用。
- 模型输出、工具进度和审批事件通过 `/api/events` WebSocket 即时推送，使用顺序编号和接收确认，不再每 300ms 轮询。普通 RPC 操作仍使用 HTTP POST。
- WebSocket 每 5 秒进行协议心跳，约 20 秒没有存活确认只断开该页面的连接，任务继续执行。客户端从 0.5 秒起退避重连，最长间隔 10 秒；恢复前台或网络时及时唤醒重连，按原游标补收事件，不自动重放操作。页面连接确实过期时提示重新连接。事件缓存已过期时自动重新加载页面，通过运行快照恢复。Vite HMR 使用另一条独立连接。
- 共享事件历史最多保留最近 5000 条或 8 MiB，单个页面的接收确认不会删除其他页面待补收的事件；超限仅淘汰最旧事件。发送积压只断开对应慢连接。刷新通过后端运行快照恢复，已保存的历史从会话加载，当前文字/思考分别保留最多 131072 字符，与界面显示上限一致。

## 低带宽与远程访问的加载优化

`dev:web` 是开发入口：浏览器要加载许多源码模块、开发版依赖和 HMR 连接。跨高延迟链路访问时，应优先使用**构建后的 Web 入口**，而不是把开发服务器当作日常远程工作台：

```sh
node scripts/build-web.mjs
pnpm serve:web --host 127.0.0.1 --port 5173 --workspace /absolute/path/to/project
```

这里的回环地址适合同机的受控访问代理；直接局域网访问时替换为电脑实际 IPv4。**此命令保持独立 Web 的固定工作区语义，不等同于 `dev:web` 的多工作区模式，也不会接管另一个进程中的活动任务。** 更换入口或重启后端前先结束活动任务；仅运行构建不会热更新已经启动的后端。无需构建 Electron、打包安装或改动 CLI 启动器。

生产静态服务（独立 Web 与桌面 LAN 共用）现在提供：

- JS/CSS 等文本资源按浏览器 `Accept-Encoding` 协商 Brotli / gzip，异步流式压缩；小文件与已压缩字体/图片不重复压缩。
- `assets/` 下带 Vite 内容哈希的文件使用一年 `immutable` 缓存；构建内容改变后 URL 会随之改变。HTML 和无哈希文件仍须重新验证，支持 ETag / 304，避免刷新时重新下载整个页面资源。
- 设置、用量看板和组件展示页按需下载；首次打开有加载提示，失败时可返回工作台。关闭已加载面板不会丢弃设置草稿、筛选条件或会话输入。
- API、会话与预览内容不加入上述静态资源缓存；不要在代理上把 `/api/` 或整个站点强行缓存。

若代理不转发 `Accept-Encoding`，或改写/丢弃 `Cache-Control`、`ETag`、`Vary`，传输优化可能无法生效。开发者工具中如果仍看到 `/@vite/client`、大量 `.tsx` 请求，说明访问的还是开发入口。不要通过放开 Host/Origin 校验来解决性能问题。

**安全边界不变：Forge 没有内置访问鉴权，任何可达者都可能操作工作台及执行获准命令。不要无保护地穿透到公网；远程入口必须另有可信的身份验证、HTTPS 和访问控制。性能优化不提供这些安全能力。**

可复现验证（临时存储、fixture provider，不读取真实密钥）：

```sh
node scripts/build-web.mjs
pnpm exec vitest run tests/web-static.test.ts tests/web-loading-browser.test.ts tests/lan-host.test.ts tests/lan-browser.test.ts
```

限速 Chromium 样本（150ms 延迟、1.536Mbps 下载，已配置的空工作台）：优化前静态资源传输约 1.46 MB，首次显示约 8.6s、刷新约 8.5s；优化后约 0.37 MB，首次约 2.9s、刷新约 1.0s，刷新时静态资源传输为 0。时间是本机模拟网络的单次样本（等待输入框、桥接与字体就绪），不是对真实穿透线路的承诺；测试断言压缩、缓存与按需加载行为，不用易波动的耗时作为通过门槛。

## 会话记录按轮加载

- 打开或切换会话时，默认只请求最近一轮完整对话（用户请求、该轮工具执行和回复），不预取旧消息、旧图片和旧工具结果。
- 向上滚动接近顶部时，再加载前一轮；短会话或键盘操作也可以点击顶部的「加载更早对话」。加载失败保留当前内容，可显式重试。加载到开头后停止请求。
- 前插历史保持当前阅读位置；实时回复仍按原规则跟随尾部，不把历史加载当成新回复。切走会话会释放已展开的历史，重新进入仍从最近一轮开始。
- 分页是 `getSessionPage` RPC 的数据切片，不只是折叠界面。`getSession`、磁盘原始记录、模型上下文与导出保持完整；累计用量使用固定大小的历史汇总，不因分页清零。当前已经加载的轮次仍保留在内存中，单轮特别大时仍可能占用较多内存。
- 此改动包含共享契约和后端处理：开发模式需要在活动任务结束后重启 `pnpm dev:web`，再刷新页面；仅 Vite 热更新不足以更新 RPC。生产入口先执行 `node scripts/build-web.mjs`，再重启现有 Web 服务，不需要打包或安装 Electron。

## 旧会话迁移

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

- 预览文档由后端单独返回（`POST /api/preview`、`POST /api/preview/file` 取得一次性 URL，`GET /preview/document?id=…` 返回内容），和主页面同源，默认需要有效的设备 cookie（或自定义客户端的 Bearer 凭证）；URL 中的 id 为 24 字节随机值，保留最近 24 个文档、30 分钟、合计 8 MiB。
- 预览文档只以 `sandbox="allow-scripts"` 嵌入（没有 `allow-same-origin`），所以脚本在预览内运行，但读不到工作台 DOM、cookie 或工作区文件；文档 CSP 为 `default-src 'none'`、`connect-src 'none'`、`form-action 'none'`，图片/字体/媒体只允许 `data:`/`blob:`，无法访问网络。`X-Frame-Options` 仅对这个端点放宽为 `SAMEORIGIN`，工作台其余页面仍是 `DENY`。
- 按路径读取文件的预览只在单工作区服务中可用，且只读取工作区内、非符号链接、非隐藏路径（`.git`、`.env*` 等一律拒绝）、UTF-8、不超过 1 MiB 的 `.html`/`.htm` 文件。`dev:web` 多工作区模式拒绝此入口，避免将其他项目的相对路径误读为启动项目；代码块 HTML 预览仍可用。
- 该能力依赖 Web 后端端点，桌面 Electron 宿主没有对应实现，因此共享 renderer 在桌面端不显示预览按钮。修改后端或共享契约后需要重启 `pnpm dev:web`；只改 renderer 时热更新即可。

## 访问边界

直连范围和生命周期见 [LAN 直接接入](LAN_AUTHORIZATION.md)。这是个人局域网中的单用户 HTTP 入口，不是公网部署方案、多租户服务或 OS 沙箱。网络可达范围由用户管理；工具权限与审批保持原设置。

HTTP 和事件 WebSocket 保留精确 Host/Origin、JSON POST、页面标识、游标及大小限制。Vite HMR 是独立的开发连接与 token 边界；开发 HTML 的 CSP 为 HMR 放宽，生产 HTML 不变，预览仍使用严格 CSP 和无 allow-same-origin 的沙箱。

## 聚焦检查

```sh
pnpm exec vitest run tests/web-host.test.ts tests/web-bridge.test.ts tests/web-socket-browser.test.ts tests/renderer/html-preview.test.ts tests/renderer/html-preview-mounted.test.ts
```

浏览器冒烟必须先使用临时 `FORGE_HOME` 启动独立 dev fixture 服务（默认直连），避免读取真实配置或改动用户会话，然后运行：

```sh
node scripts/check-web-dev.mjs http://192.168.8.108:5174
```

此脚本使用本机 `/usr/bin/google-chrome-stable`，验证显式兼容模式进入、共享界面、HMR socket、可编辑的服务器路径、跨工作区会话创建/修改/列表和刷新恢复，不调用外部模型；会在临时存储中创建两个 fixture 会话，并自动清理另建的临时项目目录。结束后停止临时服务并删除临时 `FORGE_HOME`。单元测试另用 fixture provider 验证真实 Harness 运行与事件传输，不代表真实 Provider 或所有工具均已端到端验收。
