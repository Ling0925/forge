# Android 原生 Core 联调 fixture

`tests/native-core-fixture.mjs` 是给当前 Android 原生 Kotlin 客户端联调用的
**API-only fixture**：

- **真实**：从 `../repos/forge-core/dist/web/server.js` 导入 `createWebHost`，从
  `dist/host/runtime.js` 导入 `createRuntimeHub`。HTTP 路由、WebSocket 事件、
  controller 的运行/审批/取消状态机、`getSessionPage` 分页、workspace fallback
  文件读取，以及 `dist/core/input-queue.js` 的 durable input queue 都是 Core 实现。
- **离线 fake**：`HarnessService` 是脚本内的内存实现，只产生固定的离线回复；
  settings/provider source、usage、MCP、checkpoint 元数据也是 fake。它不读取真实
  Forge 配置、会话、provider 密钥，不发起任何模型/MCP 网络请求。
- 队列存储和整个 fixture 状态都放在
  `android/.gradle/native-fixture/run-<pid>-<random>/`，正常停止时删除。fixture
  会把子进程的 `FORGE_HOME` 指向这个隔离目录。

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

默认端口是 **18765**，供人工/Android 测试长期运行。smoke 默认使用 **18766**，
自动启动并清理。两者都只监听回环地址。

启动后应看到类似输出，其中没有令牌或 provider 信息：

```text
[native-core-fixture] ready
  origin: http://127.0.0.1:18765
  mode: trustedLan API-only (no pairing, no auth)
  model: fixture-offline (offline fake; no provider calls)
  state: .gradle/native-fixture/run-... (removed on stop)
  android: adb reverse tcp:18765 tcp:18765 && use http://127.0.0.1:18765/
  prompts: hello | workbench | approval | slow | any 中文 text -> stream
  files: README.md, src/example.kt, docs/guide.md (isolated workspace)
  queue: real Core durable input-queue under state/input-queue (isolated FORGE_HOME)
  data: simulated usage, settings/provider sources, MCP metadata and one sample checkpoint
  stop: Ctrl+C
```

`Ctrl+C` / `SIGTERM` 会关闭 Web host、runtime host、input queue 并删除本次生成的目录。
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

## 支持的方法与数据

`createSession` 的 `workspace` 请直接使用 `/api/connect` 返回的 `workspace`；fixture 是
restricted 单 workspace host，只接受它自己 `runRoot/workspace` 的 realpath 等价路径，
不会在 `runRoot` 之外创建文件。

会话与运行：

- `listSessions`、`createSession({workspace,...})`、`getSession`
- `getSessionPage`（Core 路由分页，fake 只提供 `getSession`）
- `getHostState`（真实 controller；检查活跃 run、`pendingApprovals`、`stopping`）
- `startRun`、`cancelRun`、`answerApproval`
- `renameSession`、`archiveSession`、`forkSession`、`compactSession`（no-op）
- `getDiagnostics`、`getProjectContext`、`getUsageStats`
- `getSettings`、`updateSettings`、`listModels`
- `listWorkspaceEntries`、`readWorkspaceFile`（Core controller fallback 读取隔离 workspace）
- 队列：`enqueueInput`、`listInputs`、`cancelInput`、`pauseInputs`、`resumeInputs`
- MCP：`listMcpServers`、`registerMcpServer`、`setMcpEnabled`、`removeMcpServer`、`getMcpHealth`
- checkpoint：`listCheckpoints`、`getCheckpointDiff`、`restoreCheckpoint`

`getDiagnostics` 返回 `transcriptChars`、`projectedChars`、`messageCount` 和
`summaryFallback`；`getProjectContext` 返回两条模拟 instruction source（`AGENTS.md`、
`docs/AGENTS.md`）、一个模拟 skill（`.forge/skills/fixture-workbench`）、一条 warning
和对应 counts。它们只针对隔离 workspace，不读取真实用户级 Forge 配置。

`forkSession` 复制边界内的 messages、`plan/plans` 和部分会话元数据，使用新的 UUID、
`Fork: <title>` 标题、`status:"idle"`、空 `events`/`changes`，并设置 `forkedFrom`。
默认会话以及没有 plan 的 fork 的 `plans` 是空数组；`workbench` 之后才有 plan/change。

### 工作台 prompt 与结构化数据

`startRun` 的 `input.prompt` 决定离线行为（精确匹配，先 `trim()`）：

| prompt | 行为 |
| :--- | :--- |
| `hello` | 流式返回 `Hello from the offline Forge Core fixture.` |
| 其它文本 / 中文 | 流式回显并返回中文说明，不调用真实模型 |
| `workbench` | 结构化 Markdown/表格/Kotlin 代码回复，并产生计划、变更和模拟 usage |
| `approval` | 触发一次真实的 controller 工具审批 |
| `slow` | 发一条 `text_delta` 后等待 `cancelRun`，最多 120 秒 |

默认 `createSession` 快照是空的：`messages/deltas/changes` 为空，`plans` 为空数组，
没有 plan。因此旧聊天/审批测试不会突然看到计划或变更。

`workbench` 额外产生：

- `reasoning_delta`、`text_delta`，回复包含标题、Markdown 表格和 Kotlin 代码块；
- `plan_updated` 事件和 `session.plan` / `session.plans`（`fixture-workbench-plan`）；
- `session.contextSummary`（模拟的上下文摘要，`fallback:false`）；
- `context_usage` 事件（带 `windowTokens`、`budgetTokens`、`parts` 等真实 schema 字段）；
- 一次 `tool_started` / `tool_finished`，其 `result.changes` 和 `session.changes` 指向
  `docs/workbench-report.md`，`patch` 由 Core 的 `createDiffPatch` 生成；
- `run_finished.usage` 与 `getUsageStats` 的非零统计。

usage 是 **模拟的**：fixture 固定加入一组 base token/run 数据，再叠加当前内存会话
中 `run_finished.usage`。没有真实模型计费、provider 请求或价格计算；
`getUsageStats.pricing.state` 固定为 `unavailable`。`topSessions` 只包含本次 fixture
真实创建的内存会话。

### 隔离 workspace 文件

启动时 fixture 只在自己的 `runRoot/workspace` 创建：

```text
README.md
AGENTS.md
docs/AGENTS.md
docs/guide.md
src/example.kt
.forge/skills/fixture-workbench/SKILL.md
```

`listWorkspaceEntries` / `readWorkspaceFile` 不实现 fake 方法，由真实 Core controller
的 fallback 读取 `getSession().workspace`。目录遍历会忽略敏感路径和符号链接；
`src`、`docs` 等相对路径可以直接浏览。审批写入的 `fixture-approval.txt` 和
workbench 写入的 `docs/workbench-report.md` 也只会落在该隔离目录。

### 设置与 provider sources

`getSettings` 返回可被 Core `publicSettingsSchema` 校验的公开设置，包含：

- `baseUrl`、`model`、`theme`、`defaultPermission`、`maxTurns`、`maxToolCalls`、
  `requestTimeoutMs`、`contextBudgetChars`；
- 推理/上下文相关：`reasoningEffort`、`maxOutputTokens`、`contextBudgetTokens`、
  `modelContextWindows`；
- 两个可读 provider source 公共 metadata：`fixture-local` 和 `fixture-cloud`；
- 一个 `fixture-route` route group，以及 `activeSourceId`。

`updateSettings` 支持：

- `{settings: {...}}`：合并并保存受 Core schema 约束的字段；
- `{source: {type:"save", source:{...}, expectedRevision?, apiKey?}}`；
- `{sources: [<source operation>...]}`；
- `{source: {type:"activate", id}}` / `{source: {type:"remove", id, forgottenSessionIds?}}`；
- `{route: {type:"save", group}}` / `{route: {type:"remove", id}}`。

source save 会把 revision 从 1 开始递增；`expectedRevision` 不匹配时返回
`invalid_input`（模拟并发编辑冲突）。activate 会把来源投影到公开的
`baseUrl/model/apiMode` 并更新 `activeSourceId`。remove 正在被会话引用的来源会要求
`forgottenSessionIds` 确认，和真实 store 的约束一致。**`apiKey` 只接受但立即丢弃，
不存储、不回显，`hasApiKey` 始终为 false；fixture 不连接任何真实 endpoint。**

`listModels` 对应 Core 的 `service.listModels(signal, sourceId, refresh)`：

- `listModels({sourceId:"fixture-local"})` → `["fixture-offline"]`
- `listModels({sourceId:"fixture-cloud"})` → `["fixture-cloud-model","fixture-cloud-mini"]`
- 省略 `sourceId` 时使用当前 `activeSourceId`；新 source 返回它保存的 model/modelSelection。
- 未知 source 返回真实的 `not_found` RPC 错误。

这些模型列表是 fixture 的固定目录，不发起 catalog 网络请求。

### checkpoint（明确不是 Core 真实 checkpoint 实现）

默认会话（包括普通聊天/审批 session）的 `listCheckpoints` 为空。只有执行过
`workbench` 的会话会得到一个稳定样例：

- 固定 UUID `c0f1e2d3-4a5b-4c6d-8e9f-0123456789ab`
- `path: "src/example.kt"`，`kind: "modified"`，真实 SHA-256 before/after hash
- `getCheckpointDiff` 返回一段真实 unified diff 字符串
- `restoreCheckpoint` 只做两件事：把 `src/example.kt` 覆盖为 fixture 的 after 内容，
  并把本次内存 checkpoint 标成 `restored`

它没有 Core 版本历史、对象存储、工具事务或真实回滚语义。**不要把该样例当成 Core
checkpoint 能力**；Android UI 可以验证列表/diff/恢复路由和渲染。

### MCP（metadata-only）

初始列表有两个 fake 记录（一个 stdio、一个 remote），都只是 DTO。fixture 支持：

- `listMcpServers` 返回严格 `mcpRecordDto`；remote 记录 `command:""`、`args:[]`，
  header 只暴露数量/是否存在，不暴露 header 名或值；
- `registerMcpServer` 接受 stdio/remote 注册 DTO，重复 id 返回 `invalid_input`；
- `setMcpEnabled`、`removeMcpServer`、`getMcpHealth`；
- health 永远 `connected:false`，`lastError` 明确说明 metadata-only。

fixture **不启动子进程、不执行命令、不发起 HTTP/SSE、不调用 MCP 工具**。注册的
command/url/header 只是内存 metadata。Android 应显示离线/未连接状态，而不是假定
健康检查成功。

### durable input queue

fixture 复用 Core 的真实 `openInputQueue` store/service，并挂到
`service.inputQueue`；controller 用真实 `attach`/`finished` 生命周期消费队列。
队列文件在隔离的 `runRoot/state/input-queue/queue.json`，不会读写真实 Forge 队列。

语义与 Core 一致：

- `enqueueInput` 幂等：相同 `inputId` + 相同内容返回原记录，不重复入队；不同内容
  返回 `invalid_input`；
- `pauseInputs` 后新输入保持 `queued`，不会自动启动；
- `cancelInput` 只取消 queued/blocked 输入；
- 如果前一个 run 以 `cancelled`/`failed` 结束，finish 会把该会话标记 paused；排队输入
  不会自动重放，必须显式 `resumeInputs`；
- bound/uncertain 记录不会自动重放；重启 host 后由真实 store 恢复为 uncertain；
- 消费完成的记录是 `consumed`，重复 enqueue 不会再次启动 run。

`enqueueInput` 的 `input.permission`/`model` 由 fixture 的 `prepare` 固定到 session 当前
值；provider binding 是一个固定 fixture 值，不会访问 provider。

## 运行 smoke

`tests/native-workbench-smoke.mjs` 会：

1. 自动在 **127.0.0.1:18766** 启动 fixture（可用 `NATIVE_FIXTURE_PORT` 改端口）；
2. 做 `/api/connect` HTTP 握手和 WebSocket lease；
3. 通过真实 RPC 路由验证 settings 保存、provider source save/activate/remove、
   `listModels(sourceId)`、rename/archive/fork、workspace files、hello/approval 聊天；
4. 验证 `workbench` 的 Markdown/代码/表格回复、plan、change、context/usage、checkpoint
   list/diff/restore；
5. 验证 MCP 严格 DTO 的 list/enable/health/register/remove；
6. 验证 durable queue 的 pause/cancel、取消后必须显式 resume、consumed 不重放；
7. 在 `finally` 中关闭 WebSocket、发送 `SIGTERM`、必要时 `SIGKILL`，并清理 fixture
   run 目录。任何子进程都不会脱离 smoke 进程。

```sh
cd android
node tests/native-workbench-smoke.mjs
```

成功时应看到 `PASS: native workbench fixture smoke completed`，且
`.gradle/native-fixture/` 下没有残留的 `run-*` 目录。如果 Core dist 不存在、端口被占用、
或任一 RPC/schema 断言失败，脚本会以非零状态失败；它**不会**把失败当成 skip 标成通过。

人工联调仍使用默认 18765：

```sh
node tests/native-core-fixture.mjs
# 另一个终端
adb reverse tcp:18765 tcp:18765
```

### 交互消息：普通流式、approval、slow

普通 `hello`/中文文本事件顺序：

```text
run_started
generation_started
text_delta (可多条)
generation_finished
run_finished (status=completed)
```

服务端同时持久化 user message 和 assistant durable message。收到 `run_finished`
后再调用 `getSession` 应能看到 assistant 消息。

`approval` 使用 `permission: "readonly"` 或 `"workspace"`（默认 `workspace`），顺序为：

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

批准后 fake 工具会在隔离 workspace 写 `fixture-approval.txt`；拒绝则不写文件，仍然以
completed 结束并产生 assistant 消息。这里触发的是 Core controller 的真实审批/等待/
广播路径，但工具本身是 fake，不经过 Core 的真实工具执行器。

如果 `startRun` 使用 `permission: "unrestricted"`，Core 会自动消费审批，
`approval_requested` 可能不会出现在事件流中；要测试审批卡片请使用 `readonly` 或
`workspace`。

`slow` 先产生 `text_delta`，然后保持运行。客户端用：

```json
{
  "id": "<新 UUID>",
  "method": "cancelRun",
  "runId": "<startRun 返回的 runId>",
  "wait": true
}
```

预期收到 `generation_finished(status=cancelled)` 和 `run_finished(status=cancelled)`。
取消后不写 assistant 消息。`cancelRun` 的 `wait` 可选；不等待时 RPC 立即返回，终态仍
通过 WebSocket 推送。请使用 `cancelRun`，不要依赖 `cancelSession`（fixture 中返回
false，不停止 run）。

## 已验证范围与限制

本 fixture 的 smoke 已在当前环境用 Node 22.23.1 通过：HTTP/WS 握手、settings 保存、
两个 provider source 的目录/metadata/save/activate/remove/expectedRevision、每来源
listModels、默认空会话、rename/archive/fork、隔离 README/src 文件读取、hello 流式、
approval 真实 controller 审批及隔离写文件、workbench 结构化回复/plan/change/context/
usage、checkpoint list/diff/restore、MCP DTO CRUD、durable queue pause/cancel/
explicit resume/no-replay，以及停止后目录清理。2026-10-22，父任务还在 Android 11 /
API 30 模拟器上通过了 `nativeApp` 的 Compose 交互测试：连接、流式聊天、审批允许/拒绝、
停止、活动会话切换、草稿、旋转/前后台重连、历史分页、离线禁发及真实深色渲染。

在 fixture 已运行、模拟器已执行 `adb reverse` 的前提下：

```sh
./gradlew :nativeApp:connectedDebugAndroidTest
adb pull /sdcard/Download/native-chat-light.png
adb pull /sdcard/Download/native-chat-dark.png
adb pull /sdcard/Download/native-approval-light.png
```

这些测试操作的是真实 Kotlin/Compose UI，不是仅编译或 HTTP 冒烟；模型与工具仍为 fake，
真实模型/公网代理/真机键盘不在此次验收范围。

限制：

- API-only，没有 renderer、登录、配对或鉴权；只监听 `127.0.0.1`，不要暴露到不可信网络。
- 会话、事件、usage、settings、MCP、checkpoint 状态都在内存中（队列持久化在隔离
  `state/input-queue`）；fixture 重启即清空，不会读取或写入真实 Forge 会话。
- `SessionSnapshot` 的真实 schema 没有 `subagents` 数组字段；fixture 不伪造该字段。
  Agent 会话通过真实的 `parentSessionId`/child session 机制表达，本 fixture 没有
  seed 子会话。默认会话的 `plans`/`changes` 为空，workbench 才填充。
- 模型固定为 `fixture-offline`，没有 token 计费、上下文压缩或图片内容处理；usage 是
  模拟值，pricing 明确为 `unavailable`。
- checkpoint 是单一内存样例 + `src/example.kt` 隔离文件覆盖，不是 Core 真实
  checkpoint 实现。
- MCP 是 metadata-only：不启动子进程、不执行命令、不访问 URL、不调用工具；health
  始终未连接。
- `modelAccess`（真实 catalog/测试/登录流程）未实现；source 目录使用固定
  `listModels(sourceId)`，不发起网络请求。
- `slow` 若没有取消，最多等待 120 秒后正常结束，方便避免永久挂起。
- `getHostState` 只反映 controller 当前活跃 run；run 结束后 `runs` 会变空。
- 真实 Core 版本变化可能改变路由/事件 schema；本 fixture 直接导入已构建的 Core，
  不复制契约。升级 Core 后重新运行 `node tests/native-workbench-smoke.mjs`。
