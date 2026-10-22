# Android 原生 Core 联调 fixture

`tests/native-core-fixture.mjs` 是给当前 Android 原生 Kotlin 客户端联调用的
**API-only fixture**：

- **真实**：从 `../repos/forge-core/dist/web/server.js` 导入 `createWebHost`，从
  `dist/host/runtime.js` 导入 `createRuntimeHub`。HTTP 路由、WebSocket 事件、
  controller 的运行/审批/取消状态机都是 Core 实现。
- **离线 fake**：`HarnessService` 是脚本内的内存实现，只产生固定的离线模型回复。
  不读取真实 Forge 配置、会话、provider 密钥，不发起任何模型网络请求。
- 状态全部放在 `android/.gradle/native-fixture/run-<pid>-<random>/`，正常停止时删除。

## 前置与启动

需要 Node 22（Core `engines` 要求 `>=22.23.1`）和已经构建的 Core。fixture 不会构建、
安装或修改 Core。

```sh
cd android
test -f ../repos/forge-core/dist/web/server.js
node tests/native-core-fixture.mjs
```

如果上面的文件不存在，先构建 Core（不改源码，只生成 `dist`）：

```sh
(cd ../repos/forge-core && pnpm build)
node tests/native-core-fixture.mjs
```

启动后应看到类似输出，其中没有令牌或 provider 信息：

```text
[native-core-fixture] ready
  origin: http://127.0.0.1:18765
  mode: trustedLan API-only (no pairing, no auth)
  model: fixture-offline (offline fake; no provider calls)
  state: .gradle/native-fixture/run-... (removed on stop)
  android: adb reverse tcp:18765 tcp:18765 && use http://127.0.0.1:18765/
```

`Ctrl+C` / `SIGTERM` 会关闭 Web host、runtime host 并删除本次生成的目录。
进程被 `SIGKILL` 或崩溃时可能留下 `run-*` 目录，可直接删除
`android/.gradle/native-fixture` 下对应目录；不要删除正在运行的目录。

## 模拟器连接

```sh
adb reverse tcp:18765 tcp:18765
```

App 里填写根地址：

```text
http://127.0.0.1:18765/
```

必须使用 `127.0.0.1`，不要用 `localhost` 或 `10.0.2.2`：Core 会校验
`Host: 127.0.0.1:18765`，fixture 也只监听回环地址。用 `localhost`/`10.0.2.2`
会得到 `403 Unexpected host`。

## HTTP / WebSocket 合同

fixture 完全走 Core 的真实路由，Android 客户端需要满足 Core 的同源约束：

### 1. 建立页面连接

```http
POST /api/connect
Origin: http://127.0.0.1:18765
Content-Type: application/json

{}
```

返回 `clientId`、`workspace`、`cursor`、`recovery` 和 `restrictWorkspace`。
trustedLan 模式不需要 cookie、Bearer 或配对。

### 2. 发 RPC

```http
POST /api/rpc
Origin: http://127.0.0.1:18765
Content-Type: application/json
X-Forge-Client: <上一步的 clientId>

{"id":"<UUID>","method":"listSessions"}
```

响应为 `{id, ok, method, result}` 或 `{id, ok:false, method, error}`。
`id` 必须是新的 UUID；重复 id 会被 Core 返回 409。`getHostState`、
`listSessions`、`createSession` 等常用方法都由真实 controller 路由。

### 3. WebSocket 事件

```text
ws://127.0.0.1:18765/api/events?clientId=<clientId>&cursor=<cursor>
```

- 请求头必须带 `Origin: http://127.0.0.1:18765`。
- 不要设置 `Sec-WebSocket-Protocol` 子协议；Core 会拒绝。
- 消息格式是 `{cursor, events:[{runId, event}]}`。
- 客户端应回 `{"cursor": <收到的 cursor>}`；trustedLan 不是强依赖，但能保持连接活跃。
- `startRun` 前必须先建立 WebSocket：Core 要求页面有打开的 event lease，否则
  返回 `409 Event connection expired. Reload before starting a run.`。

首次连接用 `/api/connect` 返回的 `cursor`（通常 0）；重连时用最后一批消息的
`cursor`。fixture 是内存状态，重启后旧 cursor 不再有意义。

### 4. 分页与快照

- `getSession` 返回完整快照。除非客户端能处理 Core 的增量格式，否则不要发送
  `X-Forge-Snapshot` 请求头；不发送时 fixture 始终返回完整快照。
- `getSessionPage` 由 Core 的 Web 路由调用 `paginateSession`，默认返回最新一个
  执行回合；可用 `page: {before: <messageOffset>}` 取上一页，或
  `page: {from: <messageOffset>}` 取从该页到最新的窗口。
- 分页游标必须是回合边界；非边界会得到 `invalid_input`。

## 支持的 fake 方法

`createSession` 的 `workspace` 请直接使用 `/api/connect` 返回的 `workspace`；fixture 是
restricted 单 workspace host，Core 会做 realpath 校验。

会话与运行：

- `listSessions`、`createSession({workspace,...})`、`getSession`
- `getSessionPage`（Core 路由分页，fake 只提供 `getSession`）
- `getHostState`（真实 controller；检查活跃 run、`pendingApprovals`、`stopping`）
- `startRun`、`cancelRun`、`answerApproval`
- `getSettings`、`updateSettings`、`listModels`（返回 `fixture-offline`）
- `renameSession`、`archiveSession`、`compactSession`（no-op）
- `getDiagnostics`、`getProjectContext`、`getUsageStats`
- `listCheckpoints`（空）、`getCheckpointDiff`（空）、`restoreCheckpoint`（报不支持）
- `listMcpServers`（空）、`removeMcpServer`（no-op）

未完整实现的功能：真实 MCP 注册/健康检查、真实 checkpoint 恢复、published files、
durable input queue、真实工具执行。Android 对应面板可能显示错误或空状态，这不代表
Core 路由失败。

## 交互消息

`startRun` 的 `input.prompt` 决定离线行为（精确匹配，先 `trim()`）：

| prompt | 行为 |
| :--- | :--- |
| `hello` | 流式返回 `Hello from the offline Forge Core fixture.` |
| 其它文本 / 中文 | 流式回显并返回中文说明，不调用真实模型 |
| `approval` | 触发一次真实的 controller 工具审批 |
| `slow` | 发一条 `text_delta` 后等待 `cancelRun`，最多 120 秒 |

### 普通流式回复

事件顺序：

```text
run_started
generation_started
text_delta (可多条)
generation_finished
run_finished (status=completed)
```

服务端同时持久化 user message 和 assistant durable message。收到 `run_finished`
后再调用 `getSession` 应能看到 assistant 消息。

### approval

`startRun` 时使用 `permission: "readonly"` 或 `"workspace"`（默认 `workspace`）。
顺序为：

```text
run_started
generation_started
text_delta
generation_finished
approval_requested   <- 带 request.id；getHostState.pendingApprovals 可见
approval_resolved    <- 客户端 answerApproval 后由真实 controller 广播
tool_started
tool_finished
run_finished (status=completed)
```

`answerApproval` 请求：

```json
{
  "id": "<新 UUID>",
  "method": "answerApproval",
  "runId": "<startRun 返回的 runId>",
  "approvalId": "<approval_requested.request.id>",
  "approved": true
}
```

批准后 fake 工具会在隔离 workspace 写 `fixture-approval.txt`；拒绝则不写文件，
仍然以 completed 结束并产生 assistant 消息。这里触发的是 Core controller 的真实
审批/等待/广播路径，但工具本身是 fake，不经过 Core 的真实工具执行器。

如果 `startRun` 使用 `permission: "unrestricted"`，Core 会自动消费审批，
`approval_requested` 可能不会出现在事件流中；要测试审批卡片请使用 `readonly`
或 `workspace`。

### slow / stop

`slow` 先产生 `text_delta`，然后保持运行。客户端用：

```json
{
  "id": "<新 UUID>",
  "method": "cancelRun",
  "runId": "<startRun 返回的 runId>"
}
```

预期收到 `generation_finished(status=cancelled)` 和
`run_finished(status=cancelled)`。`cancelRun` 的 `wait` 可选；不等待时 RPC 立即
返回，终态仍通过 WebSocket 推送。取消后不写 assistant 消息。请使用
`cancelRun`，不要依赖 `cancelSession`（fixture 中返回 false，不停止 run）。

## 已验证范围与限制

本 fixture 在当前环境用 Node 22.23.1 做过命令级验证：正常 `hello`/中文流式事件、
`getSession` durable assistant、`getSessionPage` 最新页与 `before` 上一页、
approval 的 `approval_requested`/`approval_resolved`/tool 事件及隔离文件、
`slow` + `cancelRun` 取消、`getHostState` 的 pending/stopping，以及停止后状态目录清理。
2026-10-22，父任务还在 Android 11 / API 30 模拟器上通过了 `nativeApp` 的 Compose 交互测试：连接、流式聊天、审批允许/拒绝、停止、活动会话切换、草稿、旋转/前后台重连、历史分页、离线禁发及真实深色渲染。

在本页 fixture 已运行、模拟器已执行 `adb reverse` 的前提下：

```sh
./gradlew :nativeApp:connectedDebugAndroidTest
adb pull /sdcard/Download/native-chat-light.png
adb pull /sdcard/Download/native-chat-dark.png
adb pull /sdcard/Download/native-approval-light.png
```

这些测试操作的是真实 Kotlin/Compose UI，不是仅编译或 HTTP 冒烟；模型与工具仍为 fake，真实模型/公网代理/真机键盘不在此次验收范围。

限制：

- API-only，没有 renderer、登录、配对或鉴权；只监听 `127.0.0.1`，不要暴露到不可信网络。
- 会话和事件都在内存中，fixture 重启即清空；不会读取或写入真实 Forge 会话。
- 模型固定为 `fixture-offline`，没有 token 计费、上下文压缩或图片内容处理。
- `slow` 若没有取消，最多等待 120 秒后正常结束，方便避免永久挂起。
- `getHostState` 只反映 controller 当前活跃 run；run 结束后 `runs` 会变空。
- 真实 Core 版本变化可能改变路由/事件 schema；本 fixture 直接导入已构建的 Core，
  不复制契约。升级 Core 后重新运行本页命令即可。
