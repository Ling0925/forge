# Forge CLI 计划进度固定在输入区上方需求

本文是 **CLI 终端**的需求文档：把计划（Plan）进度固定在输入区（docked composer）上方，便于随时查看进度。
**范围：仅 CLI 终端**（`src/cli/**`）。**不涉及桌面**（`src/renderer/**`）。
它描述目标行为、现行实现、设计约束、待决问题与验收标准，**不是**已通过验收的声明。

- 相关契约：[CLI.md](CLI.md)（终端交互）、[WORKFLOWS.md](WORKFLOWS.md)（plan 语义）、[ARCHITECTURE.md](ARCHITECTURE.md)。
- 术语：**计划**指原生工具 `update_plan` 写入的持久结构化状态 `TaskPlan`（**不是**从 Markdown 清单解析出来的，见 `WORKFLOWS.md:159`）。
- **固定**指该区域**不随对话滚动**、常驻在输入行上方（非固定终端回落为普通追加行）。

## 1 需求摘要

1. 计划进度**固定在 CLI 输入区上方**，随对话滚动而**不移动**。
2. 进度需**一眼可读**：当前进行中的步骤 + 整体进度（如 `2/5`）。
3. 无计划时不占位。
4. 步骤最多 100 项（`schemas.ts:335`），固定区**必须有界**，不得挤占输入行与正文。

## 2 现状（经代码核对，仅 CLI）

**计划目前只以"滚动行"形式出现，会随对话滚走**；终端没有专门的常驻计划位。

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 计划事件渲染 | `plan_updated` → `planEventLines(plan)` 追加为**滚动行** | `src/cli/render/events.ts:124-126, 213-226` |
| 行格式 | `Plan` 标题 + `explanation` + 每步 `n. step · status`（tone：完成/进行中/待办） | `events.ts:213-226` |
| `/plan` 命令 | 取 `getSession().plan`，用 `planLines` **追加**到滚动区 | `src/cli/interactive.ts:419-422` |
| 可复用格式化器 | `planLines(plan, width)`：`✔ [done]` / `● [active]` / `○ [pending]` | `src/cli/format.ts:150-180` |
| 输入区（dock） | 固定屏下渲染顺序：`status? + composer + below + pending + footerLines` | `src/cli/terminal/view.ts:249-255` |
| dock 槽位预算 | `limit = min(10, rows-1)`；footer 最多 2 行；pending 最多 2 行；status 1 行 | `view.ts:36, 38-50` |
| 常驻先例 | **`contextFooter`**（模型 + token 条）已是常驻底部两行 | `src/cli/terminal/context-footer.ts` |
| UI 契约扩展点 | `setStatus/setBusy/setMode/setInputHint/setPendingInput/setContext` | `src/cli/ui-contract.ts:99-116` |
| 模式已可见 | 提示符在 plan 模式下已变色（`view.mode === "plan"` → `warning`） | `view.ts:68` |

关键约束：

- `taskPlanSchema`：`steps` 为 `1..100`；**至多一个 `in_progress`**（`schemas.ts:339`）；`explanation` ≤ 4096。
- 计划是**持久结构化状态**，可跨重启恢复；`/plan` 直接读会话快照。
- 终端渲染为 `RichLine[]`（`Span` 语义 tone）；**只有终端控制器可写转义序列**（`ui-contract.ts` 信任模型）。
- `NO_COLOR` / `TERM=dumb` / 非 TTY 走 plain 输出（`CLI.md:52`）。

## 3 目标

1. 富终端（fixed 屏）下，**无需任何命令**即可看到计划进度。
2. 进度在**对话滚动时保持可见**。
3. 当前 `in_progress` 步骤**突出**（复用 `warning` tone）。
4. **不占用**输入行与正文的既有空间契约。

## 4 非目标

- 不改变 `update_plan` 语义与 `TaskPlan` 结构。
- 不把计划从结构化状态改为解析 Markdown 清单（明确禁止，`WORKFLOWS.md:159`）。
- **不涉及桌面**（`src/renderer/**` 的 Inspector / Composer 计划展示不在本需求范围）。
- 不改变 `/plan` 命令的既有输出语义（是否与固定区去重见 §7 Q3）。
- 不引入编辑能力（只读展示）。

## 5 功能需求

### 5.1 位置与固定（R-P 系列）

- **R-P1**：计划进度固定在 **docked 输入区上方**（composer 之上、正文之下）。
- **R-P2**：滚动正文时该区**不移动**（属于 dock，不属于 scrollback）。
- **R-P3**：其出现/消失**不得**导致输入行位置或正文滚动跳变（参照既有"背景活动不得改变编辑器物理行"的注释，`view.ts:43-44`）。
- **R-P4**：仅在**富终端/固定屏**（`screen.fixed`）启用；非固定终端**回落**为既有追加行，不新增常驻区。

### 5.2 内容与状态（R-C 系列）

- **R-C1**：至少展示：当前步骤文本 + 状态 + 整体进度（`已完成 n/m`）。
- **R-C2**：`in_progress` 必须**突出**（复用 `warning` tone，与 `/plan` 输出一致）。
- **R-C3**：已完成/待办用既有符号语义（`✔ ● ○`，`format.ts:150-157`），保持一致性。
- **R-C4**：`explanation` 为长文本，固定区**默认不展示全文**（可截断或通过 `/plan` 查看）。
- **R-C5**：无计划（`plan` 为 `undefined`）时**不占位**。

### 5.3 有界与优先级（R-B 系列）

- **R-B1**：固定区高度**有上限**（建议 1–3 行）；超出按"当前步 + 进度摘要"收敛，**绝不**逐条列出 100 步。
- **R-B2**：与既有 dock 槽位（status / pending / footer）**优先级必须明确**，不得互相挤爆：
  - 建议顺序：审批/选择器 > 输入行 > 计划（1–3 行）> pending > footer > status。
  - 窄/矮终端下按优先级**降级**（见 §7 Q2）。
- **R-B3**：不得因新增固定区而破坏"输入行始终可见"或"矮窗口下缩略"的既有行为（`CLI.md:44`）。

### 5.4 数据与更新（R-D 系列）

- **R-D1**：固定区数据源为**最新一次 `plan_updated`**（或会话 `plan`），与 `/plan` 同源，**不新增数据通路**。
- **R-D2**：`plan_updated` 到达时固定区**实时刷新**。
- **R-D3**：需通过扩展 `TerminalUI` 契约传入（建议新增可选 `setPlan?(plan | null)`，与 `setContext` 同模式，保持向后兼容），**旧 fake UI 必须能优雅降级**（`ui-contract.ts:118-122` 的 feature-detect 约定）。
- **R-D4**：会话切换（`/resume`、`/new`）时固定区必须**同步**为新会话的计划（或清空）。

### 5.5 可见性与降级（R-V 系列）

- **R-V1**：非固定终端（`TERM=dumb` / 非 TTY）：保持现有 `planEventLines` 追加行为，**不引入**常驻区。
- **R-V2**：`NO_COLOR` 下颜色被禁用，但**文字/符号语义仍必须可辨**（状态不能只靠颜色）。
- **R-V3**：符号（`✔ ● ○`）应与文本标签（`[done]/[active]/[pending]`）一致，避免仅符号歧义。

## 6 与现有实现的关系

- **落点**：`view.ts` 的 dock 组装处（`view.ts:249-255`）是插入点，计划行应在 `composer` **之前**（输入行上方）。
- **槽位预算**：需同步调整 `limit`/`fixedFooter`/`contentLimit`/`statusSlot` 的分配（`view.ts:36-50`）。
- **契约**：在 `TerminalUI` 增加可选 `setPlan?`（`ui-contract.ts:99-116` 同区）。
- **控制器**：`Controller` 增加 `plan` 状态与 `setPlan`（与 `setContext` 同模式，`controller.ts`）。
- **生产者**：`interactive.ts` 在收到 `plan_updated` 时调用 `ui.setPlan(...)`。
- **复用**：直接复用 `format.ts` 的 `planStatus`/`planLines` 语义与符号，避免两套符号。

## 7 待决问题

- **Q1**：固定区默认显示几行？（建议 1–2 行：`Plan 2/5 · ● 当前步骤`）
- **Q2**：矮窗口（如 `rows < 8`）下计划区与 pending/footer/status 的**降级顺序**？
- **Q3**：`/plan` 与固定区**信息重复**如何处理（保留 `/plan` 看全文）？
- **Q4**：计划全部 `completed` 后是否**自动隐藏/淡出**？
- **Q5**：是否显示 `explanation` 截断片段？
- **Q6**：多会话/子代理运行时，固定区显示**当前会话**计划即可，还是也要子代理计划？
- **Q7**：是否需要在计划区提供**交互**（如快捷键展开全文），还是纯展示？

## 8 安全与边界约束（强制）

- **R-X1**：只读展示，不引入新写路径或权限面。
- **R-X2**：步骤文本来自模型输出 → **不可信**，必须经 `sanitizeText`/`terminalText` 处理，**不得**注入终端控制序列（`CLI.md:52`）。
- **R-X3**：只有终端控制器可写转义序列；生产者**不得**预着色（`ui-contract.ts` 信任模型）。
- **R-X4**：不得破坏既有 dock 契约与输入可用性（`R-B3`）。
- **R-X5**：不得因固定区影响**审批可见性**或输入响应。
- **R-X6**：新增契约成员必须是**可选**的，保证旧 fake UI 与测试不回归。

## 9 验收标准

- **AC-1**：富终端中，会话有计划时，输入行上方常驻显示计划进度。
- **AC-2**：滚动对话时该区**不移动**；出现/消失不引起输入行跳变。
- **AC-3**：`in_progress` 步骤突出；整体进度（`n/m`）可见。
- **AC-4**：无计划时不占位。
- **AC-5**：100 步的计划**不挤占**输入行与正文（有界）。
- **AC-6**：`plan_updated` 后固定区**实时刷新**；`/resume`/`/new` 后同步。
- **AC-7**：`TERM=dumb`、非 TTY、`NO_COLOR` 下行为正确且不产生无意义转义。
- **AC-8**：旧 fake UI（未实现 `setPlan`）不报错、不回归。
- **AC-9**：测试：`tests/cli/**` 覆盖"常驻区出现、滚动不移位、无计划不占位、有界、`resume` 同步、plain 降级"；参考既有 `tests/cli/terminal-v2*.test.ts` 与 `tests/cli/render-v2*.test.ts`。
- **AC-10**：`pnpm typecheck`、`pnpm test` 通过；按仓库约定 `node scripts/build-core.mjs` 后重开 `forge` 生效。

## 10 风险与约束

- **垂直空间稀缺（最高风险）**：终端行数有限，固定区会长期占用 1–3 行；矮窗口下必须按优先级降级（`R-B2`）。
- **dock 槽位竞争**：status / pending / footer / 计划四方竞争，映射容易出错；需在 `view.ts` 明确优先级并配测试。
- **契约兼容**：`setPlan` 必须可选，避免破坏旧 fake UI 与既有断言。
- **去重**：`/plan` 与固定区可能显示不一致（Q3）。
- **并发工作**：工作区存在其他任务对 CLI 文件（`terminal/view.ts`、`controller.ts`、`ui-contract.ts` 等）的在途改动，实现时**不得覆盖**。
- **本机流程**：按 AGENTS.md，本机 CLI 更新走"改代码 → `node scripts/build-core.mjs` → 重开 `forge`"，不做完整发布/打包。

## 11 未验证项（诚实说明）

- 本文现状均来自**源码核对**；未在真实终端实测固定区效果，未截图比对。
- 固定区对**矮窗口可用性**的影响**未实测**。
- 未统计真实会话的**计划步数分布**，行数上限取值缺乏实测依据。
- 未确认除 `events.ts`/`interactive.ts` 外是否还有其它计划展示路径需同步。

## 附：范围更正说明

本文**修订了先前误判**：最初版本把"计划固定在输入框上方"写成了**桌面**需求（Inspector / Composer），与本日"仅 CLI"的范围不符。
现版本已**完全改为 CLI 终端**范围；桌面相关内容已移除。

## 12 本轮实现记录（2026-10-14）

固定屏复用原有 status 槽位显示一行 `Plan n/m · ● [active] 当前步骤 · /plan`，不新增高度，因此计划出现/消失不会移动输入行、无计划时不新增占位。计划优先于普通运行状态/历史提示；极矮窗口无 status 槽位时隐藏计划，保留输入。完成后保留 done，全文与 explanation 仍用 /plan。只展示当前会话权威 plan_updated/快照，切换/新建同步或清空；非固定屏原追加渲染不变。

测试覆盖 100 步有界、出现/消失 dock 与 cursor row 不变、滚动仍常驻、控制字符净化；既有 fixed-screen/pending-input/scroll-selection/terminal 回归通过。未完成真实终端视觉、所有高度与 NO_COLOR 专项验收；复用状态位意味着有计划时运行耗时状态行被替代，这是本轮明确取舍。
