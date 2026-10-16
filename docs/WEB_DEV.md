# Web 开发工作台

Web 与 Electron 复用 `src/renderer` 的全部 React 页面、组件和样式；`src/shared/bridge.ts` 是共用的已校验 RPC 桥接，只有宿主通信与少量能力不同。CLI 和桌面启动入口不变。

## 启动

```sh
pnpm dev:web --host 192.168.8.108 --port 5173 --workspace /home/ling/services/desktop-harness
```

请替换成本机实际局域网 IPv4 和项目目录。不传参数时只监听 `127.0.0.1:5173`，工作区为当前目录。必须指定单个 IPv4，不能用 `0.0.0.0`。服务启动后打印访问地址和随机访问口令，在浏览器登录页输入口令即可。重启会更换口令与 cookie。

运行时使用现有 Harness 默认配置与存储（尊重 `FORGE_HOME`），API 密钥留在 Node 后端，不发送回浏览器。没有配置模型时，在共享设置页配置。Web 会话列表仅显示启动工作区，会话操作也会检查其工作区。目录选择按钮返回固定的服务器工作区，不是浏览器所在机器的目录；桌面文件导出在 Web 中禁用。

- renderer 的 React/CSS 由 Vite 热更新，无需编译或重开 Electron。
- 共享核心、Web 后端与启动脚本修改后，需要结束当前任务并重启此命令；不会在代理改代码时自动重启后端。
- 只有一个控制页面。刷新、新页面接管或网络断开不会取消任务；任务由后端持有，重新连接会恢复运行标识、当前输出、权限与未处理审批。断线期间审批继续等待，不自动批准。主动停止或关闭/重启后端仍会取消运行。
- 请求失败不会自动重放。检查会话、文件和命令状态后再决定是否重新操作。
- 模型输出、工具进度和审批事件通过 `/api/events` WebSocket 即时推送，使用顺序编号和接收确认，不再每 300ms 轮询。普通 RPC 操作仍使用 HTTP POST。
- WebSocket 每 5 秒进行协议心跳，约 20 秒没有存活确认只断开连接，任务继续执行。客户端从 0.5 秒起退避重连，最长间隔 10 秒，按原游标补收事件，不自动重放操作；登录过期或页面被接管则停止重连。事件缓存已过期时自动重新加载页面，通过运行快照恢复。Vite HMR 使用另一条独立连接。
- 未确认事件缓冲最多 5000 条或 8 MiB，发送积压也受限；超过上限只断开事件连接。刷新通过后端运行快照恢复，已保存的历史从会话加载，当前文字/思考分别保留最多 131072 字符，与界面显示上限一致。

## 安全边界

这是可信局域网中的单用户 **HTTP 开发入口**，不是公网部署方案、多租户服务或 OS 沙箱。口令、会话、代码等在 HTTP 网络上传输，没有 TLS 加密；不要端口转发到公网，不要在不可信网络使用。

页面、源码、API 和所有 WebSocket 均要求认证。HTTP API 额外校验精确 Host/Origin、JSON POST 和控制页标识；事件 WebSocket 校验 Host/Origin、认证 cookie、控制页标识和事件游标。认证 cookie 为 HttpOnly、SameSite=Strict，最长 12 小时；HMR WebSocket 另保留 Vite token 校验。只有 Web dev 的 HTML 放宽 CSP 以支持 HMR，桌面生产 HTML 的 CSP 不变。认证用户仍具有与本机使用 Forge 类似的强大能力（包括配置 Provider/MCP 和批准命令）；固定工作区不把命令变成沙箱。

## 聚焦检查

```sh
pnpm exec vitest run tests/web-host.test.ts tests/web-bridge.test.ts tests/web-socket-browser.test.ts
```

浏览器冒烟必须先使用临时 `FORGE_HOME` 启动独立 dev 服务，避免读取真实配置或改动用户会话，然后运行：

```sh
node scripts/check-web-dev.mjs http://192.168.8.108:5174 <临时服务口令>
```

此脚本使用本机 `/usr/bin/google-chrome-stable`，验证登录、共享界面、HMR socket、桥接会话 CRUD 和刷新握手，不调用外部模型；会在临时存储中创建一个 fixture 会话。结束后停止临时服务并删除临时 `FORGE_HOME`。单元测试另用 fixture provider 验证真实 Harness 运行与事件传输，不代表真实 Provider 或所有工具均已端到端验收。
