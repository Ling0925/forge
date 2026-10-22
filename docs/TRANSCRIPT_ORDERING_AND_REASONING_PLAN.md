# 对话流思考自动收起与工具调用时序归并修改计划

> **状态：核心修复已落地（2026-10-22）；实际实现与验证边界见 §9，不代表完整验收矩阵全部通过。**
>
> 本文针对共享 renderer 在多步工具调用中出现的「工具参数生成时思考未收起」「思考与工具卡片顺序倒置」及同步交接跳变。§1–8 保留修复前的源码审查、设计目标和验收矩阵；其中“当前代码”“拟新增”等描述是实施前基线，不应当作最新实现状态。
>
> 范围：`src/core/runtime.ts`、`src/shared/schemas.ts`、`src/renderer/state/{workbench-reducer,transcript-sync,timeline}.ts`、`src/renderer/components/workbench/{Transcript,Reasoning}.tsx`，以及协议经过的存储、bridge、恢复与 provider 序列化路径。
>
> 设计依据：[DESIGN.md §9、§11](../DESIGN.md)。本方案扩展「工具参数开始生成即收起」「纯思考不显示空作者头」「按生成实例同步」三项规则，实施时须同步修订 DESIGN，不能将其表述为现有契约已经保证。

## 1. 现象与目标

### 1.1 现象

1. 模型开始生成工具参数，出现「编辑文件 · 生成参数中」，思考块仍保持 5 行 live 视口，没有转为折叠摘要。
2. 参数生成时「思考 → 工具」顺序正常；工具开始执行后，工具进入已保存 transcript 上层，思考留在 Live Tail 下层，变成「工具 → 思考」；异步快照到达后又恢复。
3. 无正文、只有 reasoning 与工具调用的 assistant 消息保存后新增 `Forge` 作者栏，与此前裸思考块的结构不同。
4. 多步输出拥有相同前缀时，滞后的上一生成结果可能被误认为当前 live 缓冲的保存确认。

本文的“思考完成”指 **done 展示状态**，不是 UI 必须显示的字面文案。现有 `Reasoning` 在 done 时显示最后非空行摘要，点击可展开；不应新增虚构的思考内容。

### 1.2 修复应维持的不变量

- 同一生成实例只展示一份思考和一份正文，保存确认不依赖文本恰好相似。
- 同一步有多个工具时，思考/正文只出现一次，位于该步第一张工具卡之前；不能在每个工具前重复插入。
- 原生 `snapshot.messages` 顺序是已保存内容的权威顺序；归并临时内容不能改写历史消息顺序。
- 本生成的思考转为 done 后，清空正文、重置预览、接收快照不能让它回到 live；下一生成实例可以独立进入 live。
- live → pending → saved 保留逻辑展示身份和用户手动展开状态；不以“排序正确”替代这一要求。
- 不丢失未确认的输出；历史数据缺少关联信息时明确降级，不把猜测当确认。

## 2. 已确认的实现问题与边界

代码位置以下以文件和符号定位，避免源码变动后固定行号失效。

### 2.1 思考 live 判定与缓冲冲刷不完整

[`Transcript.tsx`](../src/renderer/components/workbench/Transcript.tsx) 的 `answerStarted` 取实时正文或快照最后一条 assistant 正文；实时 `Reasoning` 使用：

```tsx
live={!run.streamingText && !answerStarted}
```

它没有考虑工具预览，所以纯工具步骤没有正文时仍会保持 live。且 `answerStarted` 不带生成身份，不能作为多步思考生命周期的长期依据。

[`runtime.ts`](../src/core/runtime.ts) 在 provider attempt 内对思考按 256 字符或 22ms 冲刷，对正文按 8192 字符或 80ms 冲刷；`onText` / `onToolCall` 未先冲刷思考，`.finally()` 也是 `flush()` 在 `flushReasoning()` 之前。因此已有尾部思考可能晚于正文或首个工具预览发出。

两者是独立问题：调整 runtime 时序只避免“已有尾块晚发”，**不会单独改变 renderer 的 live 状态**，也不能强制 provider 本身不交错输出。

CLI 的 `src/cli/render/events.ts` 已在正文或工具预览等边界结束思考展示，可作为交互语义参考，但不应照搬所有事件：`context_usage` 在 provider 请求前和返回后都会发出，不能统一解释为思考结束；`tool_preview_reset` 也只是清理预览，不是生成完成证明。

### 2.2 StoredTranscript 与 Live Tail 分层导致顺序倒置

`Transcript` 先渲染 `StoredTranscript`，再渲染 pending 正文、pending 思考、live 思考、live 正文及工具预览。`StoredTranscript` 使用 [`reduceTimeline`](../src/renderer/state/timeline.ts)，既读 messages，也从 `tool_started` / `tool_finished` 合成工具项。

在工具事件已到、包含 assistant 消息的快照尚未到的窗口中：

| 阶段 | 上层 StoredTranscript | 下层 Live Tail | 屏幕顺序 |
| --- | --- | --- | --- |
| 思考与参数生成 | 用户消息 | 思考、工具预览 | 思考 → 工具 |
| 工具开始/完成，快照滞后 | 用户消息、事件合成的工具卡 | pending 思考/正文 | 工具 → 思考 |
| assistant 快照到达 | 用户消息、assistant 思考/正文、工具卡 | 对应 pending 被清除 | 思考 → 工具 |

`workbench-reducer.ts` 在 `tool_started` 将 streaming 缓冲转入 pending，并清空 streaming 字段。这解释了上述窗口；**工具事件不是 assistant 消息已被当前客户端同步的证明**。

### 2.3 空作者头与 React 身份交接是不同问题

`Transcript.tsx` 的 `renderTimelineEntry` 对 assistant 消息渲染作者栏，即使该项只有 reasoning、没有正文。实时/pending 思考原先裸渲染，所以保存后出现额外作者行和间距。具体位移受 CSS、阶段标题和分组影响，不应写成所有场景固定增加某个像素数。

另外，现有 saved 消息 key 为 `message:${index}`，实时思考 key 带 run/streamingTurn，pending 又有独立 ID。跨父级或更换 key 会重挂载；`Reasoning` 的 `expanded` 是内部 `useState(false)`，所以用户展开状态可能丢失。

移除空作者头能减少结构差异，但**不能证明 DOM 不重挂载、所有高度一致或滚动完全不动**。

### 2.4 前缀去重与原始工具 ID 都不足以确认实例

[`transcript-sync.ts`](../src/renderer/state/transcript-sync.ts) 的 `outputSaved` / `reasoningSaved` 从 `afterMessage` 开始，以正文/思考前缀及可选 `toolCallId` 匹配。以下风险需要一起处理：

- 上一步快照落后于下一步流式输出，且两步拥有相同前缀，可能误清下一步缓冲。
- 不能简单给无 `toolCallId` 的匹配加 `!message.tool_calls?.length`：runtime **先保存 assistant 消息，再发 `tool_started`**，合法快照可能先到；此时缓冲尚未绑定工具 ID，会被错误拒绝确认，产生重复展示。
- 游标越界不能回退为 `0`，否则会重新扫描全部历史并放大误匹配。消息数量也不能区分重试或消息列表被替换。
- 原始 `toolCallId` 不保证跨步骤、跨轮次唯一。现有 `timeline.ts` 按 occurrence 处理重复 ID，`tests/renderer/timeline.test.ts` 已有相应案例。不能从头寻找第一个相同 ID，将本步思考插到历史工具之前。

因此不保留旧版文档的两个现成补丁：`!message.tool_calls?.length` 过滤和仅按 `toolCallId` 的 `mergePendingTimeline`。它们不是安全的跨步骤修复。

## 3. 先建立最小的生成实例关联协议

### 3.1 身份粒度与工具实例

一次用户运行可包含多次 provider 请求，一次请求又可重试。引入本地生成的 `generationId`，**每次 provider attempt 都分配新 ID**；不要用用户轮次、`streamingTurn`、原始工具 ID 或 preview ID 代替它。

- ID 由 runtime 分配，在同一会话内跨运行、重试和重启不复用；可使用随机 UUID，并始终与 `sessionId` 联合校验。它是关联标签，不是认证或权限凭据。
- 接受的 assistant 消息保存可选 `generationId`；同一会话内一个 ID 至多对应一条被接受的 assistant 消息。
- 工具实例使用 `(sessionId, generationId, callIndex)`，其中 `callIndex` 是最终 assistant 消息 `tool_calls` 数组下标；原始 `call.id` 保持 provider 协议原义，不改写。
- 预览携带生成身份及 provider 的工具 index。只有适配器已验证该 index 与最终数组下标对应时，才将预览关联为正式调用；否则清理预览、展示正式工具，不猜测绑定。`previewId` 不能解析后冒充全局生成身份。
- 同一步多个工具共享一个生成输出块，工具各有自己的 callIndex。新格式不能继续仅按 `toolCallId` 将完成事件关联到历史调用。

### 3.2 建议协议字段与事件

以下名称为实施约定，不是当前已有 API：

| 载体 | 新增信息 | 用途 |
| --- | --- | --- |
| assistant 消息 | 可选 `generationId` | 快照直接确认归属，不必等工具开始 |
| `generation_started` | `generationId`，开始时的消息边界提示 | 在首个 delta 前建立实例；边界只辅助定位 |
| `reasoning_delta`、`text_delta`、`tool_call_preview`、`tool_preview_reset` | 可选 `generationId`；预览另带 index | 将实时数据与清理操作限定到实例 |
| `generation_finished` | `generationId`，`completed / failed / cancelled / superseded` 结果 | 明确请求结束，不借用用量事件 |
| `retry_reset` | 可选 `generationId`，指被放弃的 attempt | 只清本次失败草稿，下一 attempt 使用新 ID |
| `tool_started`、`tool_finished` | 可选 `generationId`、`callIndex`（有则成对校验） | 新格式按具体调用实例关联 |
| renderer 草稿/pending | `sessionId`、`generationId`、通道及展示身份 | 同步和渲染使用同一归属 |

新 runtime 必须完整发送新协议；schema 字段可选是为了读取旧记录，不代表新写入可随意缺省。生成开始/结束及工具关联元数据可进入事件日志；**reasoning/text 增量与预览仍走现有 ephemeral 路径，不能为归并而写入事件日志**。

`generation_finished(completed)` 在最终 assistant 消息成功保存后发送。它可触发一次有界快照刷新，但事件本身不等于当前客户端已收到消息，不可据此清掉待同步文本。失败/取消在 finally 冲刷后结束实例；重试丢弃用 `superseded` / `retry_reset` 明确表达，避免误当成功保存。

### 3.3 必须贯通的边界

1. 更新 `src/shared/schemas.ts` 的严格 schema，以及共享类型、事件转发、session store、快照解析和恢复路径；新增字段不能在中途被 strict parser 拒绝或被投影静默丢掉。
2. runtime 在验证 provider 返回值后附加本地 ID，不信任 provider 自行返回的同名字段，也不改变 `tool_calls` 与工具结果协议。
3. 审计 `src/provider/{openai,responses,anthropic}.ts` 及其他请求序列化路径：使用显式白名单映射，禁止把本地生成元数据发送给模型；`reasoning` 继续仅用于展示，不改作 providerState 或正文。
4. 断线恢复须保留现有有界实时预览规则，并携带对应生成身份；不能因新增协议持久化思考增量。恢复不到正文时只展示真实保存内容，不伪造已丢失的流。
5. 重复或冲突 ID、跨会话事件及不合法 callIndex 不能触发误清或错绑；保留原数据并进入明确的诊断/兼容分支，不自动重放请求或工具。
6. 区分“新版读取旧记录”和“旧版连接新版 runtime”：可选字段只保证前者，不能让旧 strict schema 自动接受新增字段/事件。本机配套更新应同步重启宿主与 renderer；若需支持混合版本，先做明确的能力协商/兼容投影，并将无身份路径标记为降级，不能声称旧客户端天然兼容。

## 4. Runtime 冲刷与 renderer 生命周期

### 4.1 Runtime 的局部时序修改

在现有 provider attempt 内做最小修改，保留长度上限、节流、取消和重试约束：

1. 分配 ID，先发 `generation_started`，再调用 provider。
2. `onText` 接受有效的非空正文、`onToolCall` 接受有效预览时，先 `flushReasoning()`，再执行原正文缓冲或 `previews.push()`；拒绝的空/无效回调不应制造阶段切换。
3. `.finally()` 先禁用后续回调，再依次 `flushReasoning()`、`flush()`、`previews.close()`。定时器必须清理，不能在下一 attempt 晚发上一 attempt 的尾块。
4. 成功结果附加 ID 并保存，再结束该生成实例；工具开始前仍保留“先保存 assistant 消息”的顺序。
5. 重试只放弃失败 attempt 的草稿/预览；已保存历史消息和已执行工具不回滚、不重跑。下一 attempt 的事件不能与旧 attempt 合并。

这保证切换前已收到的思考先发出，不保证 provider 从不在正文后继续发 reasoning。交错流按下述 done 锁存策略处理。

### 4.2 按生成实例维护状态，不使用全 run 的单一布尔值

建议将生命周期与通道保存确认分开：

- 生命周期：`generating → awaiting_snapshot → acknowledged`，以及失败、取消或重试放弃的终态。
- 思考展示：实例内 `reasoningDone` 默认 false，一旦正文或工具预览开始即锁存 true。
- 正文/思考各自有文本、截断标记和确认状态；新生成开始时冻结上一生成，而不是覆盖它的 pending 数据。

| 事件/输入 | 思考展示与缓冲行为 |
| --- | --- |
| 本实例首个 `reasoning_delta` | 尚未锁存 done 时显示 live；没有文本不渲染空块 |
| 本实例有效正文/工具预览开始 | 锁存 done，显示最后非空行摘要 |
| done 后同实例再到 reasoning | 累积真实文本，但不重新展开 live；不伪造新阶段 |
| `tool_started` / `generation_finished` | 作为兜底锁存 done；成功/失败/取消时保留未确认通道，`superseded` 则仅放弃本 attempt 草稿；不依赖首个工具事件才绑定身份 |
| `context_usage` / `tool_preview_reset` | 只更新各自用量/预览状态，不打开或结束思考 |
| `SET_ACTIVE_SNAPSHOT` | 仅确认匹配实例的通道；同实例消息已保存时锁存 done，即使结束事件尚未到达，也不再保持 live |
| 下一 `generation_started` | 新实例可 live；旧实例仍独立保留 |
| `retry_reset` | 只放弃明确指定的旧 attempt，不清历史已保存内容 |
| 运行终止 | 所有剩余实例停止 live；未确认内容保留并标明状态 |

同 ID 的快照已接受后，要记录终结/确认信息，避免延迟 delta 又新建第二份 live 块。旧 attempt 的迟到回调应先由 runtime 的 `streaming` guard 阻断，renderer 还需按实例状态兜底。不要通过检查 `toolPreviews.length` 或快照最后一条正文反推生命周期。

## 5. 快照确认与历史兼容

### 5.1 新格式按身份确认

在 `SET_ACTIVE_SNAPSHOT` 使用实际选定并合并的快照（保留 `mergeTranscript` 对滞后读取的保护），按 `(sessionId, generationId)` 查找 assistant 消息：

1. 找到唯一同实例消息后，用其最终正文/思考替代相应已保存通道，不要求全文或前缀相同。流式预览与最终内容允许合法不同或被截断。
2. 正文与思考分别处理。同实例消息含正文但缺少 reasoning 时，不能因此宣称思考已持久化。非空实时思考可留在同一展示块，标记为“未保存的思考预览”；正文亦同理。缺失通道的产品处理须显式实现和测试，不能静默当作保存确认。
3. 合并保存内容、移除已确认草稿引用在同一次 reducer 更新中完成；同一通道不能同时以 saved 和 live/pending 两份渲染。
4. 快照早于 `tool_started` 到达也可确认，不要求已有工具绑定；晚于下一生成到达，只能确认自己的 ID，不能清下一生成。
5. 重复快照确认幂等；较旧快照不撤销已确认结果，也不让 done 回到 live。冲突 ID 不自动选第一条或回退为文本匹配。

`generation_finished` 是刷新提示与生命周期边界，**不是快照确认**。运行结束也不能无条件丢弃未确认 pending；需覆盖最终刷新失败、取消、存储失败和会话切换后的有界保留/恢复，并向用户如实提示未保存内容。

### 5.2 无身份的旧数据：保守降级而非全局猜测

- 无实时草稿的历史快照继续按原生消息顺序和既有 occurrence 规则显示，不要求迁移旧 transcript。
- 旧事件只在确知同一运行边界、消息区间及唯一调用 occurrence 时辅助定位；原始 ID 相等、工具名相同或文本前缀相同都不是单独的确认依据。
- `afterMessage` 仅是当前消息列表的定位提示；越界、列表缩短或区间归属不明时，返回“无法确认”，不回退到历史起点，不因空缓冲就推进尚未确认实例的边界。
- 无法唯一关联的临时输出保留为明确的“待同步/未确认预览”，不插进某个历史工具前，也不冒险删除。此兼容分支可能暂时重复，不能声称拥有新协议的强去重保证。
- 旧格式的 known limitations 与新协议测试分开记录。若要在无 ID 混合版本中也提供强保证，必须先补充可靠的实例/消息映射，不能再加一个宽松前缀条件冒充修复。

## 6. 统一展示归并与交接

### 6.1 在派生阶段、轮次和工具分组之前归并

建议在 state 层建立纯函数（例如 `projectTranscript(snapshot, drafts)`）；名称可调整，职责不能退回 JSX 尾部补丁：

1. 读取原生 messages 与关联的工具事件，沿用已保存消息的权威顺序。新格式按生成身份/callIndex，旧格式沿用 occurrence，不互相误绑。
2. 以 `(sessionId, generationId)` 形成一个逻辑生成块，内部顺序为 **reasoning → assistant 正文 → 该实例的工具/预览**。已保存通道优先，未确认通道补位，不拼接一份完整 saved 文本和它的 pending 副本。
3. 有 saved 消息时以其原生位置为锚；无 saved 消息时，用已知的本运行生成顺序与具体工具实例定位。先于工具到达的 live、工具执行中的 pending 和随后 saved 均属于同一个逻辑块。
4. 同步思考/正文即使原先分为两组缓冲，也只投影一次；同一步多个工具只生成一个前置输出块。没有思考就不造思考占位，没有正文就不造回答。
5. 无可靠实例锚点时按 §5.2 保留为未确认预览，不消费历史同 ID 工具。跨轮、跨会话数据不能仅凭消息数量插入。
6. **先得到完整展示序列，再计算 stages、turns、execution/final-answer 划分、相邻工具组和滚动内容版本。** 不能先按旧 timeline 分组，再在渲染时塞入 pending；否则标题索引、当前轮归属和分组边界可能不一致。

不要将 pending 伪装为已保存 `Message` 写回 snapshot。展示模型可单独扩展；`reduceTimeline` 现有缓存只以 snapshot 对象为键，新增的投影必须也对 drafts/实例状态变化失效，避免快照不变时看不到流式更新。

### 6.2 稳定展示身份与交互状态

- 本生成块使用稳定的 `generation:${sessionId}:${generationId}` 展示身份，子项加 `:reasoning` / `:answer`，工具加 `:tool:${callIndex}`。live/pending/saved 只是来源状态，不能进入同一逻辑块的 key。
- 从 live 阶段起就由统一 transcript 展示路径渲染，尽量保持相同父级与组件类型；只改 key 而继续跨父级移动，不会保留 React 组件实例。
- **将思考的手动展开状态按展示身份提升到会话级 UI 状态，`Reasoning` 使用受控展开或等价的明确交接。** 父级因轮次分组、ExecutionProcess 或 final-answer 划分必须变化时，也不丢失用户展开选择。会话切换隔离状态；有界清理不能在正常快照交接时触发。
- 快照替换若造成重挂载，键盘焦点须在同一逻辑控件仍存在时恢复；不得将已移到其他控件的焦点抢回。测试不能仅检查 `aria-expanded` 就声称 DOM 未重挂载。
- 正文的流式 Markdown 与历史 Markdown 也应共用稳定外壳和间距；渲染器本身切换导致的合法高度变化需单独测量，不能承诺任意 Markdown 永远等高。

本方案要求逻辑身份与交互状态连续；**不无条件承诺所有 DOM 节点永不重建或所有阶段绝对坐标不变**。若实现目标进一步要求无重挂载，必须另做节点身份/挂载次数断言。

### 6.3 作者头、阶段标题与复制规则

- 无正文且有 reasoning 的 assistant 块，在 live/pending/saved 三种来源下统一只渲染思考及真实阶段标题，不新增空 `Forge` 作者行。
- 有正文时保留作者行和原有整段复制能力；复制只取该条已显示回答的原始正文，不混入 reasoning、工具参数或其他生成的正文。没有正文不提供空复制按钮。
- `StageHeader` 仍只来自真实计划步骤，归并后重新计算；不能靠新增“Forge”“思考完成”等虚构阶段来占位保持高度。
- 保留现有安全 Markdown、截断提示、无障碍和 reduced-motion 行为；移除作者头不等于可删除包含真实正文的结构。

### 6.4 预期阶段表现（新协议路径）

| 阶段 | 预期展示 | 允许/不允许的变化 |
| --- | --- | --- |
| 思考流式 | live 5 行视口 | 此时可能还没有工具，不能断言 done 与工具坐标 |
| 工具参数生成 | done 最后非空行摘要 → 工具预览 | 自动收起会合法减小高度；不再维持 live |
| 工具开始执行，快照未回 | 同一思考/正文块 → 正式工具 | 不允许工具翻到思考前面；预览替换不重复 |
| 工具完成，快照未回 | 同一思考/正文块 → 已完成工具 | 工具输出增长可改变高度，不宣称坐标恒定 |
| assistant 快照确认 | 保存通道替代同实例预览 | 不重复、不新增空作者行、不丢展开选择 |
| 下一生成开始，上一快照滞后 | 旧 pending 块保持原位，新实例独立流式 | 不以相同前缀或复用工具 ID 清理/移动旧新实例 |

## 7. 建议实施顺序与完成门槛

| 批次 | 修改范围 | 可验证的完成门槛 |
| --- | --- | --- |
| A：局部时序 | runtime 的缓冲冲刷；补小尾块测试 | 思考尾块先于本次已接收正文/预览发出；取消/重试无迟到定时器 |
| B：实例协议 | schema、runtime、本地消息元数据、事件/存储/恢复/序列化路径 | 新实例跨快照可关联；旧记录仍解析；元数据不出现在 provider 请求 |
| C：状态与确认 | reducer、transcript-sync、refresh/recovery | 生命周期按实例隔离；两种快照先后顺序都正确；无误清或重复确认 |
| D：展示交接 | timeline 投影、Transcript、Reasoning、分组和滚动依赖 | 顺序与数量稳定；展开状态连续；无空作者头；含正文的作者/复制不回归 |
| E：契约和聚焦验收 | DESIGN §9、§11 与下列测试 | 报告通过项、兼容降级和未验证范围，不以编译或旧测试代替功能验收 |

A 可独立交付，但只算缓冲时序改善；B 是 C/D 强关联保证的前置条件。不能只合并 JSX 排序补丁就宣称端到端问题已修复。此轮仅修订本文，**没有执行 A–E 的代码修改**。

## 8. 验收与聚焦测试

### 8.1 Runtime / 协议

扩展 `tests/core/reasoning-preview.test.ts`，必要时新增独立协议测试：

- 使用假定时器，喂入 `<256` 字符 reasoning 后立即正文/工具预览，断言冲刷次序；覆盖 `.finally()`、空回调、上限和定时器清理。
- 重试分配不同 ID，只清失败 attempt；取消或 provider 返回后迟到回调不污染下一实例；无工具重放。
- 同一步多个工具、没有预览的工具、不同步骤/轮次复用相同原始工具 ID，均能定位正确 callIndex。
- 新旧消息/事件 schema、实际 store round-trip、bridge 与有界恢复保留字段；CLI 等事件消费者遇到新增事件不崩溃。
- 分别捕获各 provider 的请求体，确认不含本地生成 ID、展示专用 reasoning 和临时预览元数据；不依赖真实密钥或网络请求。
- 成功保存、保存失败、重试、取消的生命周期结果互斥；每个实例至多一个终态，重复消费幂等。

### 8.2 同步与归并纯函数

扩展 `tests/renderer/{transcript-sync,timeline,tool-live}.test.ts`，检查实例、顺序、数量及保留内容，而非只匹配最终字符串：

| 场景 | 核心断言 |
| --- | --- |
| 快照先于 `tool_started` | 尚无工具绑定仍确认正确实例，不出现 saved + live 双份 |
| 工具先于快照 | pending 位于本步工具前；完成后仍不倒置 |
| 上一步快照晚于下一步 delta | 相同/完全相同前缀也不能清下一步缓冲 |
| 跨步骤、跨轮复用工具 ID | 不消费历史同 ID 工具，不移动历史消息 |
| 同一步多工具、部分工具未执行 | 输出块恰好一份，位于本步第一张工具前 |
| 正文与思考分别确认/截断 | 保存通道只展示一次；缺失通道如实标为未保存预览 |
| 重复/滞后快照、终态后迟到 delta | 确认幂等，内容不回退，不重新产生 live 块 |
| 无 ID、游标越界、列表替换 | 明确兼容降级，不扫描全部历史猜测确认 |
| 会话切换、重试、失败/取消 | 不串会话，不丢未确认文本，不恢复失败 attempt 为 live |
| 无可靠锚点、冲突生成 ID | 不错绑、不误清；诊断状态可观测 |
| snapshot 不变、draft 变化 | 投影缓存正确失效，stages/turns/分组与内容同步 |

### 8.3 挂载测试：分开断言顺序、状态与几何

扩展 `tests/renderer/{reasoning,tool-live,transcript-sync}-mounted.test.ts`，用真实 reducer 与可控 bridge/快照读取推进：

1. **思考阶段**：断言 `.reasoning-live`、5 行视口和滚动到底；无工具时不查询工具坐标。
2. **预览开始**：仅发工具预览、不发正文，断言 live 消失、done 摘要出现；有工具且思考可见时，再断言 DOM 顺序和思考矩形底边不晚于工具顶边（预先约定子像素容差，如 1px）。
3. **执行、完成、快照同步**：故意扣住快照，再分别放行；按生成实例定位思考与工具，不使用全页面第一个 selector。每步检查数量为一、思考在对应工具前、无空作者头。
4. **交互状态**：用户展开 pending 思考并聚焦标题，然后接收 saved 快照；检查仍展开、焦点归属正确、没有意外滚动抢焦点。再覆盖多步、轮次折叠/展开和 ExecutionProcess/final-answer 划分变化。
5. **几何稳定性**：对相同文本、相同宽度、相同展开态，且工具输出不增长的 pending → saved 交接，待布局稳定后比较相对 transcript 内容区的 top/height，使用明确容差。不能把 live → done 的正常收缩或新增工具输出误判为零跳动失败。
6. **回归**：含正文保留作者行与整段复制；纯思考不产生空复制按钮；阶段标题来自真实计划。检查自动跟随/用户离底阅读两种滚动策略，并覆盖 reduced-motion 和窄屏折行的必要样例。

快照先到、后到的两条路径都需要挂载覆盖。纯函数排序通过不等于 React 身份、焦点和几何已验证；挂载检查通过也不等于真实 provider 端到端完成。

### 8.4 检查命令与证据边界

已有相关测试的聚焦入口：

```sh
pnpm exec vitest run tests/core/reasoning-preview.test.ts tests/renderer/transcript-sync.test.ts tests/renderer/timeline.test.ts tests/renderer/tool-live.test.ts tests/renderer/reasoning-mounted.test.ts tests/renderer/tool-live-mounted.test.ts tests/renderer/transcript-sync-mounted.test.ts
```

本次文档修订期间，该入口的基线结果为 **7 个文件、24 项测试通过**。这是修改实现之前的现有行为检查，**没有覆盖上述新增协议和完整验收矩阵，不能证明本文方案已经实现或 bug 已修复**。

实施时只运行与当批改动相关的新增/已有测试，不默认以全量 renderer、typecheck、lint、桌面打包或安装作为前置门槛。若修改 runtime/共享核心，按仓库约定执行 `node scripts/build-core.mjs`；仅改文档无需编译。需要 CLI 启动检查时使用临时 `FORGE_HOME` 并清理，不读取真实密钥或改动用户会话。

最终报告分别列出：代码/契约改动、实际执行的检查及结果、旧格式降级、未覆盖场景。真实 provider 端到端、读屏/高对比矩阵、极长内容及复杂 Markdown 的全部几何表现，若未实际验证必须明确保留为未验证项。
## 9. 实施结果与验证边界（2026-10-22）

### 9.1 已实现

- **生成身份与生命周期**：runtime 为每次 provider attempt 分配 UUID，发出 `generation_started` / `generation_finished`，并把身份写入接受的 assistant 消息。工具事件使用 `generationId + callIndex`；重试只废弃旧 attempt，取消/异常仅关闭一次，迟到回调不能继续写预览。`projectToolContext` 从模型请求中去除本地身份与展示专用思考。
- **冲刷与恢复**：非空正文和工具预览先冲刷已有思考；工具预览前也冲刷正文。同步抛错、异步失败、取消都会排空已接受的尾块并关闭计时器。host 恢复只拼接同一生成的有界预览，按开始→增量→结束回放。
- **统一时间线**：`timeline-drafts.ts` 在轮次、阶段和工具分组之前归并正文与思考。新格式按唯一生成身份独立确认通道；相同前缀、复用的上游工具 ID、迟到快照均不能确认另一生成。纯思考不再产生空作者行；历史错误卡显示真实错误类型。未匹配执行记录的已保存工具意图不会伪装成运行中的工具卡。
- **终态与交互**：正文、工具预览、执行、保存确认或生成终态锁存 done。失败/取消预览标明“未保存”并锚定原轮次，不随“继续”挂到历史末尾；展开状态按生成键保留。补回执行中步数/重试计数，回归测试断言实际执行内容及最终回复分区，不依赖不存在的 `data-step` 容器。
- **Anthropic 兼容与诊断**：兼容缺失/空签名的展示思考和空工具 JSON 增量；无签名思考不回放成原生 thinking，不伪造签名。有签名、redacted 原生上下文仍保留；工具参数、结束帧、用量继续校验。错误使用静态阶段与原因码，不暴露原始响应或校验值，SDK 错误不能覆盖底层流截断诊断。未切换用户协议配置、未新增自动 fallback 或扩大重试范围。

### 9.2 实际执行的检查

| 范围 | 结果 |
| --- | --- |
| 下列 30 个聚焦测试文件 | **268 项通过**，不是全仓测试 |
| 24 个变更/直接依赖文件的 TypeScript 语法与语义诊断 | **0 错误**；不是全仓 typecheck |
| 真实 Transcript + reducer 的 Chromium 挂载交互 | 快照先到/后到、失败继续、相同前缀、展开/焦点保持、复制通过；相同文本 pending→saved 的 top/height 容差 1px |
| 浏览器尺寸/显示模式 | 新同步用例覆盖 1280px、390px 和 reduced-motion；执行计数用例另覆盖浅色/深色 |
| `node scripts/build-core.mjs` | 成功，更新 `dist/cli.mjs` |
| `node scripts/build-web.mjs` | 成功，更新 Web 与共享 renderer 产物；有非阻断的包体积提示 |
| CLI / Web `--help` 启动检查 | 临时 `FORGE_HOME`、无真实配置，退出码均为 0，临时目录已清理 |

聚焦测试入口（支持 brace expansion 的 shell）：

```sh
pnpm exec vitest run \
  tests/core/{reasoning-preview,provider-retries,runtime,tool-context,stream-persistence,tool-preview,tool-concurrency}.test.ts \
  tests/desktop/{tool-preview,controller}.test.ts \
  tests/provider/{anthropic,reasoning-stream,sse-compat,gemini,responses-compat}.test.ts \
  tests/renderer/{generation-sync,generation-sync-mounted,transcript-sync,transcript-sync-mounted,reasoning-mounted,tool-live,tool-live-mounted,refresh-events,workbench-reducer,timeline,session-pages,turn-execution,execution-steps}.test.ts \
  tests/cli/{reasoning-preview,reasoning-history,tool-preview}.test.ts
```

### 9.3 明确保留的边界

- 原始两次失败的上游坏帧没有保存，不能倒推它们必然由缺失签名或空参数触发。本轮覆盖确定的适配缺陷，并让以后失败具备安全的细分诊断；没有重放真实模型请求，真实 provider 端到端仍未验证。
- 新身份只覆盖新版 runtime 生成的数据。旧记录没有身份时仍是受轮次/步骤/位置约束的兼容降级，无法追溯补造可靠身份；不能把旧文本相同视为确证。
- 失败思考预览仍是当前客户端内存中的展示状态，完整页面重载或客户端退出后不保证恢复；只有已接受 assistant 消息的 reasoning 持久化。不把失败预览伪装成已保存消息或发送给模型。
- 不宣称 §8 的全部验收矩阵完成：完整高对比/读屏设备矩阵、极长内容/复杂 Markdown 的所有几何情况、真实 provider 流以及所有断线/重启组合仍未覆盖。
- 本轮未重启正在使用的 Web 服务、未中断其他会话、未运行安装或桌面打包。重开 CLI 才加载新核心；Web 后端也需要在合适时机重启以加载新协议，前端需重新加载相应新版资源。
