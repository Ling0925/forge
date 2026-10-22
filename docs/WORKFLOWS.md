# Forge 工作流指南（可运行）

本指南给出**可直接照抄**的端到端工作流，使用示例路径/占位符。所有命令均与源码一致；示例 URL、模型名、路径都是占位符，请替换为你**自行授权**的真实值。不要粘贴真实密钥到命令行、shell 历史或文档。

> 范围：Linux 桌面（Electron）与 Node 22 CLI。**不是 OS 沙箱。**已批准的本地命令、MCP 服务器进程与 harness 同权限运行；`unrestricted` 只是放宽策略，不提供隔离。

## 0 前置条件

- Linux x64。
- CLI 需要系统 `node`：`>=22.23.1 <23`。桌面包内含 Electron 44。
- 开发运行需要 `pnpm`（项目声明 `pnpm@11.18.0`）。

本指南中的命令用 `forge` 表示已安装的 CLI。若已按 [DELIVERY.md](DELIVERY.md) 安装（或从发布树
直接调用 `node .../cli/cli.mjs`），直接使用 `forge --help` 查看该构建**实际**支持的选项。

仅**源码检出**中才有以下开发入口（不在安装后的发布树里）：

```sh
# 开发检出：构建后由 node 直接运行 CLI 入口
node dist/cli.mjs --help
# 或经 package.json 脚本
pnpm cli -- --help
```

## 1 配置 endpoint、model 与可选 API 模式

```sh
# 查看公开设置（不显示密钥）
forge config show

# 设置占位 endpoint 与占位模型（替换为你自己的授权值）
forge config set --base-url https://example.invalid/v1 --model example-model

# 密钥只经标准输入，不进入 argv / 历史 / 文档
printf '%s' "$MY_PROVIDER_KEY" | forge config set --api-key-stdin

# 列出当前 endpoint 提供的模型
forge models
```

选择 API 协议模式：

```sh
# chat-completions 是默认；responses 需显式选择
forge config set --api-mode responses
```

`--api-mode` 会写入已校验的设置（底层 settings schema 与 store 均支持 `apiMode`），`forge config show` 可回读。协议语义与 Responses 的显式续跑行为见 [PROVIDERS.md](PROVIDERS.md)。

## 2 一次性运行（非交互）

`forge run` 需要**恰好一个**提示来源：位置参数 `prompt...`、`--prompt-file PATH`、或显式 `--prompt-stdin`。stdin 永不隐式读取。新会话需要 `--workspace PATH`。

```sh
# 只读运行：列出项目文件
forge run '请先列出项目文件' --workspace /absolute/path/to/project --permission readonly

# 构建模式运行（默认运行模式即 build）
forge run '修复这个失败测试' --workspace /absolute/path/to/project --permission workspace --mode build

# 计划模式：只读规划，权限被钳制为 readonly
forge run '给出重构计划' --workspace /absolute/path/to/project --mode plan

# 从文件或通过 stdin（显式）
forge run --workspace /absolute/path/to/project --prompt-file ./task.md --permission readonly
printf '%s' '继续处理' | forge run --workspace /absolute/path/to/project --prompt-stdin --permission readonly
```

运行选项（与源码一致）：`--model MODEL`、`--mode plan|build`、`--permission readonly|workspace|unrestricted`、`--prompt-file PATH`、`--prompt-stdin`、`--json`、`--yes`。

审批行为（仅本节的一次性 `forge run`，包括 `run --session`；交互式 full-access 规则不同，见 [统一权限／模式／审批说明](ARCHITECTURE.md#permission-run-mode-and-cli-approval)）：

- 只有**同时**显式给出 `--permission unrestricted` 与 `--yes` 时才自动批准。
- 该单次运行入口在 `workspace` 权限下不自动批准；非交互终端下审批会被拒绝。未显式传权限时使用共享默认 `workspace`，不会因为 `--yes` 自动升级。
- `--json` 输出**版本 1 JSONL**：每条 `{version:1, kind:"event", event:...}`，最后一条 `{version:1, kind:"result", session:...}`。

退出码：`completed` → 0；`cancelled` / Ctrl-C → 130；其他失败态 → 1。

## 3 桌面会话 ↔ CLI 会话互通

桌面与 CLI 共用**同一个** `HarnessService`、会话存储和工具（`createHarness`）。在桌面里创建的会话，可以在 CLI 里用其 UUID 继续，反之亦然。

```sh
# 列出会话（含桌面创建的）
forge sessions
forge sessions --json

# 查看某个会话快照
forge show <session-uuid>
forge show <session-uuid> --json

# 在 CLI 交互恢复桌面会话（无需 prompt，使用会话自身 workspace）
forge resume <session-uuid>

# 单次续跑 / 脚本调用使用 run --session
forge run --session <session-uuid> '继续之前的工作' --permission readonly

# 交互式 chat 打开指定 workspace/session
forge chat --workspace /absolute/path/to/project --session <session-uuid>
```

恢复语义（诚实边界）：

- 崩溃/中断时，处于 `running`/`awaiting_approval` 的会话在下次运行中被恢复为 `interrupted`，保留待定工具的**不确定性**；**不会**自动重放不确定的副作用。
- `forge resume UUID` 与 `forge chat --session UUID` 共用交互入口，加载历史后等待新输入，不创建新会话，也不自动执行。仅接受一个完整 UUID，可附加 `--approval`、`--thinking` / `--expand-thinking`；不接受提示词或 run 专用选项，非 TTY 明确拒绝。
- 会话的持久化模型是权威：`resume` 沿用会话已选模型，交互中可用 `/model` 更改。单次 `run --session UUID --model MODEL` 的覆盖只在成功获得会话锁、加载/恢复状态并确定可以开始之后生效。
- 新会话固定保存模型来源；切换全局来源不会改变已有会话的端点、协议或密钥。分叉与子会话继承来源。旧会话因没有来源记录，在下一次运行时绑定当时的活动来源；已绑定来源被删除时明确报错，需在界面显式重新选择。
- 同一会话同一时刻只有一个活动运行；并发运行以 `busy` 失败，不会静默交错。

### 3.1 桌面界面使用速览

启动 `forge-desktop`（源码检出开发用 `pnpm desktop`）。未配置 API 端点/模型时先在设置里填写，创建或运行任务前必须配置。Ctrl/Cmd+N 新建任务：选工作区绝对路径与权限后创建。输入区工具条为紧凑控件：模式（Build/Plan）、权限、模型弹层显示**精确模型 ID**（可读取目录或手输完整 ID）。执行详情默认收起，点标题栏图标展开（窄屏用"详情"标签页）；待批准以"待批准 N"药丸**始终**常驻标题栏。标题栏 ⋮ 菜单含重命名/归档/分叉/导出。快捷键：Ctrl/Cmd+K 命令面板、Ctrl/Cmd+N 新任务、Ctrl/Cmd+, 设置。减弱动效跟随系统设置；主题可选浅色/深色/跟随系统。

运行中仍可输入消息：Enter 排队，Alt+Enter 插话，沿用 CLI 的按键约定。桌面/Web 插话发送后立即写入会话，写入成功便清空原草稿、释放该会话的发送状态，不等待模型或工具结束；当前请求不中断，下一次模型请求带上这条消息，工具调用与结果保持配对。写入失败保留草稿；发送成功后即使取消运行，消息也保留在历史中，不会自动启动另一轮。发送状态按会话隔离，A 会话提交不影响 B 会话；排队保存本条消息的模型、来源、权限与模式，当前运行成功结束后按顺序启动。Shift+Enter 换行，多行草稿的普通 Enter 继续换行，Ctrl/Cmd+Enter 显式提交；中文输入法确认不触发提交。输入框上方显示纯文字快捷键提示，停止按钮单独保留。取消或失败会暂停待发队列，可输入 `/queue run` 继续或 `/queue clear` 清空；`/queue` 查看队列，`/steer 文本` 在触控设备上提供插话入口，桌面/Web 的 `/queue add 文本` 可在运行中加入多行待发消息。待发项只属于原会话，切换会话不会转移；页面刷新恢复的队列默认暂停，需要手动继续。

执行状态旁显示流式输出速度，含可见文字与思考。当前 Provider 不持续上报精确输出 token 数，界面采用有界时间窗估算并标注 `≈ … tok/s`，不把它作为计费用量；恢复的历史输出只作采样基线，等待审批、取消、重试和运行结束时不显示旧速度。

## 4 检查真实计划、代理、上下文与工具

### 4.1 交互式 chat 斜杠命令

`forge chat` 进入后输入 `/help`。支持（与 `interactive.ts` 一致）：

```
/help /model [name] /permission [readonly|workspace|unrestricted] /mode [plan|build]
/plan /sessions /resume UUID /new /fork [boundary] /rename TITLE /archive /compact /diagnostics
/context /skills /checkpoints [list|diff ID|restore ID]
/mcp [list|register ID LABEL COMMAND [ARGS...]|enable ID|disable ID|remove ID|health ID]
/export /quit
```

行尾 `\` 续行。Ctrl+C 停止当前运行；空闲时（或再次按）退出。

- `/plan` 显示**持久化**的 plan 元数据（`create_plan` / `update_plan` 原生工具写入的步骤与状态）。
- `/context` 显示项目指令来源（路径/顺序/字节数，不含正文）与技能目录；`/skills` 只显示技能列表。
- `/checkpoints list|diff ID|restore ID` 检查和恢复 checkpoint。
- `/diagnostics` 显示 `{transcriptChars, projectedChars, messageCount, summaryFallback}`。

### 4.2 非交互命令

```sh
forge context <session-uuid>          # 项目指令来源 + 技能目录 + warnings
forge skills  <session-uuid>          # 仅技能列表
forge context <session-uuid> --json
forge compact <session-uuid>          # 生成语义摘要（provider 生成）
forge fork    <session-uuid>          # 仅复制历史
forge diagnostics <session-uuid>
forge rename  <session-uuid> '新标题'
forge archive <session-uuid> [--unarchive]
```

查看工具与 diff：工具调用与结果通过运行事件（`tool_started` / `tool_finished`）按原生顺序呈现。文件改动可在 checkpoint 中查看真实统一 diff：

```sh
forge checkpoints list   <session-uuid>
forge checkpoints diff   <session-uuid> <checkpoint-uuid>
forge checkpoints restore <session-uuid> <checkpoint-uuid>
```

> 关于 `git`：`git_status`、`git_diff`、`git_log` 是**已注册的原生只读工具**（`src/tools/git.ts` + `src/tools/local.ts`），在任何模式（含 readonly）可用，不执行任何修改型 git 命令、不做 git init/commit。它们是本地工具之一，但**不是** checkpoint：Git 状态与 checkpoint 必须在 UI 中分开标注。Git 输出可能含敏感内容，host 必须在暴露给模型/renderer 前过滤/脱敏（读取 `.env` 相对路径也会被文件策略拒绝）。

## 5 plan 与 build 模式

- `--mode build`（默认）：按所选权限执行工具。
- `--mode plan`：请求权限被**强制钳制为 `readonly`**（见 `src/core/runtime.ts` 中 plan 模式的权限解析），无论 `--permission` 给什么。只读工具白名单：`list_files`、`read_file`、`search_files`、`project_context`、`load_skill`、`git_status`、`git_diff`、`git_log`，以及只读的模型发现工具 `list_models`。其他工具被核心 readonly 策略拒绝，**审批也无法覆盖 plan 模式**。
- 子代理继承父的 `permissionCeiling`：实际生效权限取"请求权限"与"父上限"中**更严格**者（见 `src/core/runtime.ts` 中取请求权限与父上限更严格者的逻辑）。

`create_plan` / `update_plan` 写入持久化 plan 并发出 `plan_updated` 事件，计划模式也可用；它们修改会话元数据而非工作区文件。计划是**持久结构化状态**，不是从 Markdown 清单里解析出来的。

新任务调用 `create_plan`，只传 `name`、`explanation`、`steps`，没有 ID 或 action 字段；返回值中的 `id` 由核心生成，`name` 保存为计划标题。继续任务时调用 `update_plan`，传返回的 ID 为 `planId`，并传完整的 `explanation`、`steps`；省略 ID 时继续当前未完成计划。每份计划最多一个 `in_progress` 步骤，独立任务保留为不同计划。旧的 `update_plan(action:create/update, title, ...)` 与无选择器调用仍兼容。

### 5.1 模型发现：原生 `list_models`

原生只读工具 `list_models` 在任何模式（含 readonly/plan）可用，只使用已配置 provider 的
`listModels(signal)`，不做任何协议改动。参数是严格对象：

- `query?`：大小写不敏感的子串过滤，最多 256 字符；返回的 ID 原样不裁剪。
- `offset?`：非负安全整数，默认 `0`；偏移相对于**过滤后**的 provider 顺序。
- `limit?`：整数 1–100，默认 `50`。

未知键、类型错误、小数或越界值会在发起发现前失败。成功结果是有效 JSON：
`{ ids, total, offset, returned, nextOffset, truncated }`。`total` 是过滤后目录数量；分页保持
provider 顺序与精确 ID，不推断能力/价格/配额；`nextOffset` 在过滤目录耗尽后为 `null`，
`truncated` 显式表示仍有剩余。完整序列化 JSON 上限 32768 UTF-8 字节；不产生残缺 JSON，也不
切割单个 ID（若单条 ID 都放不下，返回带 `total/offset/returned=0/nextOffset=offset+1/truncated=true`
的受限错误对象，而不是伪造或切割该 ID）。发现错误被脱敏（报告目录不可用，不暴露 provider
异常文本/endpoint/凭据），取消会传播运行 signal。**目录存在不代表实时配额或可用性。**

用 `spawn_agent` 指定不同委派模型前，先用 `list_models` 发现精确 ID，而不是臆造 ID；用户显式
给出的 ID 始终保留。发现失败时报告失败并只使用显式提供的 ID。

## 6 子代理：真实模型与权限继承

原生编排工具（`src/core/agents.ts`）：

- `list_models(query?, offset?, limit?)` — 只读发现 provider 目录中的精确模型 ID（见 5.1）。
- `create_plan(name, explanation, steps)` — 创建独立计划，返回生成的 ID。
- `update_plan(explanation, steps, planId?)` — 更新已有计划。
- `spawn_agent(task, ownership?, model?, writePaths?)` — 启动**独立子会话**，独立上下文/session/模型与工具注册表，共享工作区。该工具**没有子任务工具预算参数**：`maxToolCalls` 已从输入 schema 移除，传入会被 strict 校验拒绝。
- `list_agents(offset?, limit?, currentRun?)` — 分页列出父会话的当前/历史子会话，返回 `{agents,total,offset,nextOffset,truncated}`；默认每页 20，最多 50。`currentRun/active/controllable` 区分本轮执行与持久化记录；历史 `running` 可能过时，不会自动恢复或接管。ownership/路径列表也有显式截断标记。
- `wait_agents(ids?, mode?, timeout_ms?)` — `all`/`any` 等待；`timeout_ms` 默认 600000（10 分钟）、最大 1800000（30 分钟），`0` 立即轮询，超时**不取消**子任务。不传 `ids` 时返回**下一页最多 32 个尚未交付的本轮子任务**，重复不传 `ids` 即取后续页；显式 `ids` 每次最多 32 个，仅限制单次报告大小，不是累计上限。返回已结束摘要及仍活跃状态；显式历史 ID 可返回保存的结果，但不等待不属于本轮的执行。一个子任务的异常不吞掉其他结果。
- `get_agent_result(id, offset?, limit?)` — 按 UTF-16 字符偏移读取直接子会话最新的非空 assistant 报告，默认 4096、最多 8192；返回 `totalChars/truncated/nextOffset`、错误与已报告用量。支持历史结果，不读取无关会话，不恢复执行，也不是完整工具日志导出。
- `send_agent_message(id, message)` — 向本轮活跃子任务追加指令，单条最多 16384 字符、队列最多 8 条；在下一模型边界消费，不打断当前工具，不提高权限、不重启终态任务。`queued` 仅确认入队，取消/失败仍可能使其未消费；队列未消费部分不保证跨进程恢复。
- `cancel_agent(id)` — 取消并 join 本轮拥有的子任务（包括清理）；不影响兄弟任务，不能取消历史记录。
- `resolve_agent(id, resolution)` — 检查已结束任务影响后，明确记录失败/取消已如何处理。处理依据持久化在父会话，并绑定子快照版本；不修改子状态、不重放动作。活跃任务不能直接 resolve。

关键语义（诚实边界）：

- **深度为 1、并发 4**：有 `parentSessionId` 的会话不能再 `spawn_agent`；活跃并发上限固定 **4**，任务清理结束后释放名额。**不再执行工具调用次数、根任务共享次数、子代理累计数量或任务总时长上限**；`maxTurns`/`maxToolCalls`/`maxRootToolCalls`/`rootTimeoutMs` 设置字段仍保留原类型与值，`forge config set --max-turns/--max-tools/--max-root-tools/--root-timeout-ms` 也仍可写入（会提示 deprecated/ignored），但运行时完全忽略，无需迁移配置。权限与审批、手动取消、单次请求的空闲超时（`requestTimeoutMs`）仍然生效。
- **范围协调而非隔离**：可声明最多 32 个规范化的工作区相对 `writePaths`（文件或目录，无 glob、绝对路径、`..`）。与活跃子任务存在同路径/祖孙路径交集时拒绝新分配；相似前缀不算冲突，任务结束后释放范围。不声明的任务、父代理写入、符号链接别名与原生命令不受此协调检查保护；没有新增 OS 沙箱或 worktree。
- **结果按 ID 交付**：`wait_agents`/`cancel_agent` 返回终态后不重复自动汇总；未交付子结果在父收尾时**逐页（每页最多 32 个）**汇总，累计子代理不设上限。部分读取 `get_agent_result` 不代表已完整交付。摘要默认最多 4096 字符，多任务时动态缩短以保留全部 ID 和有效 JSON，显式标记截断；可按 ID 补读。
- **用量**：`run_finished.usage` 保留本任务统计，新增 `childUsage/totalUsage` 汇总本轮子任务与父子总计。只累计 provider 实际报告的请求用量，不估价、不包含未报告的消耗或额外摘要/标题请求；`usageComplete/childUsageComplete` 表示各模型主循环请求是否都有报告。子代理结果也带用量与完整性标记。
- **权限继承上限**：子会话 `permissionCeiling = 父运行权限`，子运行权限取更严格者；**权限永不超出继承上限**。`plan` 模式下的只读同样被继承。
- **真实子模型**：`spawn_agent` 的 `model?` 未给时，子会话使用父会话的模型；给出时使用指定模型。**不要在此处臆造模型 ID**——用 `list_models`/`forge models` 列出的真实值。
- 子在父 finish 时被 join；外部只发出**父作用域信封**的 `agent_update`（`{childSessionId,status,model,summary}`），子会话自己的 transcript 持久化在自己事件里；**不转发原始子事件**。
- 子审批信封使用**根** `sessionId` + 原始子 `toolCallId` + 请求 UUID；host 按待定审批 UUID 校验并显示子来源，绝不要求父 `tool_started` 配对。并发子审批被队列串行化。

**未处理的子失败仍然传播**：join 后，任一未明确 resolve 的子结果被拒绝或终态不是 `completed`，父运行请求的 `completed` 仍改写为 `failed`。主代理检查影响、独立补完并验证，或确认可放弃某辅助任务后，可用 `resolve_agent` 写明依据，让父任务正常完成；子任务原来的失败/取消状态保留。只调用 wait/read 不会自动豁免失败。构建或资源清理异常也作为失败报告，不自动重试或换模型。父自身失败或用户取消不会被 resolve 覆盖。

CLI 默认工具卡只显示状态/计数/页范围/排队状态，不展开报告正文、任务指令或处理原因；`/tools N` 可显式查看有界详情。已处理失败显示 handled，不再作为未处理失败告警；工具本身的 `isError` 仍优先。历史进度里的失败记录不抹除，也不代表整体父任务必然失败。上述接口是模型原生工具，不是新增 slash 命令。

针对性回归见 `tests/core/agent-operations.test.ts`、`tests/core/agent-runtime.test.ts`；CLI 新工具的有界展示见 `tests/cli/agent-tool-presentation.test.ts`。

## 7 语义摘要与分支（forks）

- `compactSession` / `/compact`：provider **生成**语义摘要（上限 **8192 字符**），保留稳定系统前缀，**持久化 transcript 保持不变**；投影时用 `contextSummary` 替换边界之前的消息。失败时用**显式 excerpt-only fallback**，并标记 `contextSummary.fallback=true`。诊断（`/diagnostics`、`forge diagnostics`）给出 `{transcriptChars, projectedChars, messageCount, summaryFallback}`。
- `forkSession` / `/fork [boundary]`：只复制历史到边界；边界必须是**完整的原生调用对**（`assertBoundary`），否则拒绝；**从不执行**被复制的调用。fork 保留 `permissionCeiling`/`parentSessionId` 等来源元数据。
- **fork 保留源 `contextSummary`**：当源摘要的边界**不晚于**请求的 fork 端点、且它在被复制进 fork 的源 transcript 中是完整的原生调用边界时，fork 会**原样保留**该 `contextSummary`。默认/完整 fork 会带上有效摘要；恰好在摘要边界处的 fork 也会带上；**更早**的 fork 不复制摘要（避免引入未来历史）。越界或会切裂原生调用对的摘要边界**不会**被复制。fork 不重新生成记忆，也不调用 provider/工具，不改动被包含的原始消息与精确 `providerState`。
- 自动压缩：当投影超过 `contextBudgetChars` 时，运行会在整轮边界触发摘要并发出 `context_compacted`。

### 7.1 内部收敛记录（reconciliation origin）

当父运行 join 子代理后，若还有未交付的子结果，运行时会向父会话追加一条**供模型收敛**的
`user` 消息，其 `origin` 为 `"agent_reconciliation"`。
这是**本地元数据**：

- 只有 `user` 角色允许该 `origin`；人类输入的消息**不带** `origin`。旧的快照仍然有效，不做基于内容的迁移。
- 该标记会随 schema 解析、持久化、fork 消息复制与上下文投影一起保留；provider 侧在发往
  Chat Completions / Responses 线协议时**显式剥离** `origin`（内容不丢）。
- 核心的"人类回合边界"机制会把带标记的记录视为**非**人类回合起点，同时把它保留在所属父回合里。
- 桌面 UI 把它显示为**折叠的内部记录**（`<details>`，摘要为"子代理汇总 · 内部记录"），而不是人类的"你"，并从人类回合边界中排除。

它**不是**新的 API 角色或权限面：`role` 仍是 `user`，只是一个内部来源标记。

## 8 原生 checkpoint 与命令副作用（关键区别）

这是最容易被误解的一点：

- **原生 checkpoint ≠ 命令副作用日志。**对本地工具中的**直接文件写入/编辑**（`write_file`、`append_file`、`edit_file`），`CheckpointStore` 在变更**之前**持久化私有备份（在 workspace 之外、owner-only），并在完成后校验实际字节；可按 ID 恢复**单个文件**，带冲突保护（当前字节与记录的 after 哈希不符则拒绝）。`make_directory`、`run_command` 等其他工具**不产生** checkpoint。恢复是按文件的，**不是目录级反转**，也**不是** `git reset`。
- `run_command` 的副作用**不是** checkpoint；不可自动反向。
- `FileChange` 预览（before/after 截断预览）**不是备份**，不能作为恢复内容。
- 恢复语义（`checkpoints.ts:300`）：要求 checkpoint 状态为 `completed`；要求会话非活动；要求当前磁盘字节/模式与记录的 after 一致，否则 `busy` 拒绝；只针对**一个文件**，**绝不**是 `git reset`。
- 生产环境必须把 checkpoint store 传给默认本地注册表，否则编辑**不可逆**（`local.ts` 的 `checkpointStore` 可选即为兼容旧测试）。

```sh
# 端到端：改文件 → 看 diff → 恢复
forge run '在 /absolute/path/to/project 里更新 README 标题' --workspace /absolute/path/to/project --permission workspace
forge checkpoints list   <session-uuid>
forge checkpoints diff   <session-uuid> <checkpoint-uuid>
forge checkpoints restore <session-uuid> <checkpoint-uuid>
```

## 9 注册并启用 stdio MCP 服务器（一次显式动作）

Forge 只实现 **stdio** MCP（JSON-RPC 2.0，换行分帧），协议版本 `2025-11-25`。**不支持**远端 HTTP/SSE/OAuth。

仓库自带一个真实示例服务器：`examples/mcp/echo-server.mjs`（提供 `echo` 与 `secret_report` 工具，后者仅报告一个已批准的宿主环境值是否可见，绝不返回其名称）。

```sh
# 1) 注册（显式用户动作；register 本身不启动任何进程，且注册后默认为“禁用”）
forge mcp register demo "Echo demo" node /absolute/path/to/repo/examples/mcp/echo-server.mjs

# 列出（不含密钥值）
forge mcp list

# 2) 显式启用（必须先启用，才能真正启动）
forge mcp enable demo

# 3) 健康检查（只在已启用时连接并协商；未启用不会启动）
forge mcp health demo

# 禁用 / 移除
forge mcp disable demo
forge mcp remove  demo
```

交互式等价：`/mcp register demo "Echo demo" node /absolute/path/to/repo/examples/mcp/echo-server.mjs`，以及 `/mcp list|enable|disable|remove|health`。

安全与信任模型：

- **注册/启用/禁用/移除是服务器进程唯一能变为"可启动"的途径**；项目文件里的命令**不会被自动执行**。注册后默认为禁用；只有显式 `enable` 后才可能在需要时启动（发现、调用，或对**已启用**服务器的用户主动 health 探测）。
- `readonly` 拒绝两个 MCP 工具（`mcp_list_tools`、`mcp_call_tool`），因此 **readonly/plan 模式无法通过 MCP 获得副作用**；服务器自报的 `readOnlyHint` **从不**被当作授权。
- `workspace` 要求逐次审批，审批里显示**实际注册的 `command` argv**（便于看见将要启动什么），**不含环境值**。
- `unrestricted` 自动执行，但仍只对用户显式注册并启用的服务器生效。
- **disable/remove 会撤销本进程内该服务器已建立的活连接**：`setEnabled(false)` / `remove` 会主动 `revoke` 本 harness 内属于该服务器的活动实例（关闭其子进程组）。其他进程/实例在下次生效前依据权威目录重新校验并自纠。这是**同进程**的主动撤销，**不是**跨进程强杀保证。
- 子进程使用**最小环境**（`PATH`、`TMPDIR` + 显式映射/配置的 name），**不继承**凭据；名称形如 `api_key|secret|password|token|credential|private key` 的宿主变量被拒绝，开发用 API key 永不会被转发。
- 服务器配置持久化在 `<FORGE_HOME>/mcp/servers.json`（目录 0700、文件 0600、原子写入）。**MCP 配置永不写入项目 AGENTS/skills。**

## 10 导出会话

```sh
# CLI：明确目的地；创建新文件（0600），拒绝覆盖已存在文件
forge export <session-uuid> --output /absolute/path/to/export.json
```

桌面端 `/export` 与 CLI 的 `/export` 不同：桌面使用**原生 Save 对话框**（Electron `showSaveDialog`），由用户在系统对话框中选择目标文件；不是浏览器 Blob 下载。CLI 的 `/export` 把快照 JSON 打到终端（自行重定向保存）。

导出可能包含会话文本，分享前须审查。Responses 的 `providerState` 续跑元数据属于内部状态，**可以**在非可恢复导出中被省略。

## 11 `--json` 机器契约

- `run`/`resume`：版本 1 JSONL 事件信封 + 结果信封。
- 其余检查类命令：`--json` 输出**单个** JSON 值（`jsonLine`）。
- 事件按序列有序、带 session/timestamp 与终止/失败状态；当前运行完成**不会擦除**此前失败运行的错误。

## 12 使用量与缓存边界（诚实）

- 只有服务端返回**可观测**的缓存用量时才能展示真实指标；没有命中数据时**不能**推断或保证缓存命中。
- Responses 的缓存计数来自**上报的** `input_tokens_details.cached_tokens`（含 0）；缺失则保持缺失。
- 请求成本、模型能力、Chromium/图形依赖、外部服务可用性都取决于用户环境。

## 13 取消与进程清理

- Ctrl-C / 界面取消可中止活动网络请求、工具与子进程，并保存终止状态。语义摘要（`/compact`）、分支（`/fork`）与**手动取消**均可用。
- 子代理：`cancel_agent(id)` 可取消并 join 指定子会话；主机在子任务请求取消时确认本进程是否拥有该操作。
- `run_command` 超时/取消会终止**进程组**并等待实际关闭。
- MCP：同进程内 disable/remove 会主动 `revoke` 本 harness 已建立的活连接（关闭其子进程组）；这是**同进程**撤销，**不是**跨进程强杀保证。`dispose()` 终止本实例拥有的子进程组。
- **已发生的远程副作用无法撤销。**

## 14 Responses 续跑：实测行为与边界

Responses（`apiMode: 'responses'`）的协议与续跑行为做过针对用户授权网关的实机 QA：
`read_file → tool_result → final` 的正常往返、`HarnessService` 重启后恢复同一会话、fork 保留
provider 续跑状态，以及改用不同模型后在 fork 上继续。这些是**有界的实测记录**（协议与续跑
行为的观察），不是对任意网关或本机安装的通行保证；模型 ID 与端点为运行期私有配置，不在文档中
暴露。

续跑状态的持久化上限（来自当前源码/契约）：**最多 256 个 output item**，且持久化
`ProviderState` 序列化后**不超过 256 KiB**（`src/shared/schemas.ts`，超出即拒绝并提示
"Provider continuation exceeds 256 KiB"）；SSE 输出在线协议验证时会再做一次 250000 字节的上限
检查（`src/provider/responses.ts` 的 `MAX_STATE_BYTES`）。非可恢复导出**可以**省略该内部
`providerState`。

> 开发说明：上述实测的原始记录位于源码检出的 `.omo/evidence/`（例如
> `.omo/evidence/evolution-acceptance-log.md`），**不随发布树分发**。它们只作为有界行为的佐证，
> 不等于最终打包/安装通过。

## 15 有界实测行为（开发证据，不随发布分发）

以下能力在源码检出的活动证据中有**有界**的实测记录，可作为"该行为确实在真实运行中发生过"的
佐证，但**不**作为最终发布/安装结论：原生 Electron 工作流（加载项目规则、创建计划、委派独立
子任务、改文件、跑测试、MCP echo 调用、fork/compact/export 控件）。原始记录在源码检出的
`.omo/evidence/`，**不在**发布树中，属开发证据。
