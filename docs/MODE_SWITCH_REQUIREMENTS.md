# Forge 模式切换（Shift+Tab）与提示符着色需求

本文是**模式切换快捷键**与**输入框前导提示符着色**的需求文档，覆盖 CLI 终端与会话输入界面。
它描述目标行为、现行实现、待决问题与验收标准，**不是**已通过验收的声明。

- 相关契约：[DESIGN.md](../DESIGN.md)（色彩语义与对比度）、[CLI.md](CLI.md)（终端交互）、[ARCHITECTURE.md](ARCHITECTURE.md)。
- 术语：**模式**专指运行模式 `mode`，取值 `build` 与 `plan`（`src/shared/schemas.ts` 的 `runInputSchema`）。
  它**不等于**权限 `permission`（`readonly`/`workspace`/`unrestricted`），二者正交。
- **提示符箭头**指输入框前的前导符号：CLI 为 `❯`，桌面端当前不存在（见 §2）。

## 1 需求摘要

1. 在输入框聚焦时，**Shift+Tab** 切换运行模式（`build` ↔ `plan`）。
2. 切换后，**输入框前的前导箭头符号颜色随模式改变**，使当前模式一眼可辨。
3. 切换必须**可撤销、可观测、可访问**：不能只靠颜色表达状态，不能破坏既有键盘焦点导航。

## 2 现状（经代码核对）

| 项 | CLI 终端 | 桌面会话 Composer |
| --- | --- | --- |
| 模式状态 | `let mode: "build" \| "plan"`（`src/cli/interactive.ts:103`） | `const [mode, setMode]`（`src/renderer/components/workbench/Composer.tsx:110`） |
| 切换方式 | 仅 `/mode [plan\|build]` 命令（`interactive.ts:167-173`） | 仅 `<Select id="run-mode">` 下拉（`Composer.tsx:466-479`） |
| 前导箭头 | `❯ `（`src/cli/terminal/controller.ts:116,195`） | **无前导箭头**；模式是工具栏下拉 pill（`.composer-mode`） |
| 箭头着色 | 渲染时固定 `tone: "accent"`（`src/cli/terminal/view.ts:66-69`） | 不适用 |
| Shift+Tab | **未实现**；`src/cli/terminal/keys.ts` 仅处理 `tab` | **未实现**；无 `Shift`/`Tab` 处理逻辑 |
| 键位解码 | `src/cli/terminal/decoder.ts` 的 `keys` 表**无** `\x1b[Z` | 浏览器原生 keydown |

补充事实：

- 桌面 Composer 的输入区是 `textarea.composer-textarea`（`Composer.tsx:297`），外面是 `div.composer-prompt`（`Composer.tsx:286`）。
- 桌面已有全局快捷键基础设施 `useGlobalModalShortcuts`（`src/renderer/state/modal-shortcuts.ts`），处理 Ctrl/Cmd+N、Ctrl/Cmd+、与 Escape。
- 现有切换动作会**撤销无限制授权**并**在 plan 下禁用权限选择**（`Composer.tsx:363-376`、`:471-473`），本需求必须沿用该语义。
- 终端主题通过 `Tone` 语义色（`accent`/`muted`/`warning` 等）解析，`NO_COLOR`/`TERM=dumb`/非 TTY 会降级为无着色（`src/cli/theme.ts`）。

## 3 目标

1. Shift+Tab 在输入框聚焦时可在 `build` 与 `plan` 之间切换。
2. 切换即时可见：提示符箭头颜色变化，且有非颜色的文本反馈。
3. 语义与现有下拉、`/mode` 完全一致（同一状态、同一副作用）。

## 4 非目标

- 不新增第三种模式；本项目运行模式固定为 `build`/`plan` 两种。
- 不把 Shift+Tab 用作其他用途（如"反向 Tab 焦点"以外的全局行为）。
- 不用颜色单独承担状态表达（见 §6）。
- 不改变 `mode` 与 `permission` 的正交关系；plan 仍需强制只读。

## 5 功能需求

### 5.1 键位（R-K 系列）

- **R-K1**：在输入框获得焦点且无活动 picker/弹窗时，按 **Shift+Tab** 在 `build` ↔ `plan` 间切换。
- **R-K2**：切换时**必须** `preventDefault`，避免触发终端或浏览器的默认反向焦点行为。
- **R-K3**：Shift+Tab 在其他场景**不得**劫持：
  - 桌面：焦点不在 Composer 输入区时（例如对按钮/下拉做反向 Tab 导航）不触发；有活动模态对话框时不触发。
  - CLI：处于 picker、审批交互或选区模式时不触发。
- **R-K4**：CLI 需在 `decoder.ts` 支持反向制表序列（`\x1b[Z`，CSI Z）并映射为 `shift-tab` 事件键。
- **R-K5**：实现方式与既有约定一致：桌面走 Composer 的 `onKeyDown`（与现有 Ctrl/Cmd+Enter 同层），CLI 走 `keys.ts` 的事件分派。

### 5.2 模式语义（R-M 系列）

- **R-M1**：Shift+Tab 切换后的 `mode` 必须与 `<Select>`、`/mode` 写入**同一状态**，不得出现双份真相。
- **R-M2**：切换后沿用现有副作用：撤销无限制授权（`revokeUnrestrictedConsent()`）；进入 `plan` 时权限被强制为 `readonly` 并禁用权限选择。
- **R-M3**：运行进行中（busy）时的行为必须明确：`mode` 只在运行开始时生效，建议**允许切换但只影响下一次运行**，并明确提示"当前运行模式不变"。（见 §9 待决）
- **R-M4**：切换需有可观测反馈：
  - 桌面：更新模式 pill 文案与 `aria-live` 播报。
  - CLI：输出一行 `Mode: plan` / `Mode: build`（与 `/mode` 现有回显一致）。

### 5.3 前导箭头着色（R-A 系列）

- **R-A1**：提示符箭头颜色必须**随当前模式**变化，且两种模式颜色可区分。
- **R-A2**：**CLI**：将 `view.ts` 中提示符前缀的固定 `tone: "accent"` 改为按模式解析的 tone。建议 `build` → `accent`（鼠尾草绿，保持现状），`plan` → `warning` 或新增一个中性"规划"色（需在 §6 对比度约束下选定）。
- **R-A3**：**桌面**：当前输入框**没有**前导箭头。需先决定形态（见 §9 待决）：
  - 方案 ①：在 `textarea` 前新增 `>`/`❯` 提示符元素，颜色随模式；
  - 方案 ②：不改结构，改为让**模式 pill** 的文字/底色随模式变化；
  - 方案 ③：两者都做（提示符 + pill 同步）。
  需求默认倾向 **方案 ①**（"输入框前面的 > 箭头"字面所指），但需与 DESIGN.md 的"去冗余边框、克制点缀"原则核对。
- **R-A4**：颜色必须来自既有主题 token，不得硬编码新色值；CLI 复用 `theme.ts` 的 `Tone`。
- **R-A5**：`NO_COLOR`/`TERM=dumb`/非 TTY 下降级为无色，但**文字反馈仍必须存在**。
- **R-A6**：箭头颜色变化必须随模式切换**立即重绘**，无需额外操作。

## 6 可访问性与对比度约束（强制）

- **R-P1**：颜色**不得**是区分模式的唯一线索；必须同时有文字（pill 文案 / `Mode: xxx` 回显 / `aria-live`）。
- **R-P2**：新增/变更的颜色须满足 DESIGN.md 的对比度要求：正文与图标 ≥ 4.5:1、必要图形边界 ≥ 3:1。
- **R-P3**：不得破坏键盘可达性：Composer 内的 Shift+Tab 只在输入框聚焦时拦截，其余元素的反向 Tab 导航保持原生行为。
- **R-P4**：`prefers-reduced-motion` 下不得引入动画类反馈。

## 7 验收标准

- **AC-1**（桌面）：输入框聚焦时按 Shift+Tab 在 build/plan 间切换；焦点在别处时 Shift+Tab 仍执行原生反向焦点导航。
- **AC-2**（CLI）：注入 `\x1b[Z` 后模式切换，且**不**插入制表符、不触发补全。
- **AC-3**：切换后提示符箭头颜色改变（有颜色能力时），并伴一行文本反馈。
- **AC-4**：plan 模式下权限被强制 readonly、权限选择被禁用；退出无限制授权被撤销。
- **AC-5**：`NO_COLOR=1`、`TERM=dumb`、非 TTY 下功能正常且不输出无意义转义。
- **AC-6**：有对应自动化测试：
  - CLI：`tests/cli/terminal-v2*.test.ts`（键位分派）、`tests/cli/render-v2*.test.ts`（tone 断言）、`tests/cli/interactive.test.ts`（模式状态与回显）。
  - 桌面：mounted 测试（键盘事件 + 结构/类名断言），可参考既有 `tests/renderer/*-mounted.test.ts` 模式。
- **AC-7**：`pnpm typecheck` 与 `pnpm test` 通过；CLI 改动按仓库约定 `node scripts/build-core.mjs` 后重开 `forge` 生效。

## 8 风险与约束

- **最大风险：Shift+Tab 是标准反向焦点键**。全局劫持会破坏 a11y；必须严格限定"输入框聚焦"作用域（R-K3/R-P3）。
- **桌面形态未定**（R-A3）：先决定是否新增前导箭头，否则实现方向不明。
- **终端能力差异**：并非所有终端都发送 `\x1b[Z`；需在文档与提示中说明回退手段（`/mode` 命令仍然可用）。
- **并发工作**：当前工作区存在其他任务的在途改动（`src/core/runtime.ts`、`src/core/prompts.ts`），实现时不得覆盖。
- **本机流程**：按 AGENTS.md，本机 CLI 更新走"改代码 → `node scripts/build-core.mjs` → 重开 `forge`"，不做完整发布/打包。

## 9 待决问题

1. **桌面箭头形态**：采纳方案 ①（新增前导 `❯`）、②（只改 pill 颜色）还是 ③？（影响 §5.3 实现）
2. **颜色语义**：`plan` 用哪个 tone？`warning`（语义偏"待决策"）还是新增中性规划色？（影响 DESIGN.md 是否需增补 token）
3. **busy 时切换**：允许切换但仅影响下一次运行，还是直接禁止？（影响 R-M3）
4. **切换顺序**：仅两模式，Shift+Tab 做二态切换即可，是否也需要 Shift+Tab 反向遍历以便未来扩展？
5. **CLI 提示符**：是否同时也让 CLI 在 plan 模式显示不同**符号**（如 `▸`），而非仅变色？

## 10 未验证项（诚实说明）

- 本文现状均来自**源码核对**；未运行 Electron/Vite 实际渲染，未在真实终端验证 `\x1b[Z` 的收发。
- **各终端是否发送 Shift+Tab** 未实测（不同终端/复用器行为可能不同）。
- 配色对比度**未实测**，仅引用 DESIGN.md 既有阈值。
- 桌面端当前**没有**前导箭头，故"箭头变色"在桌面属**新增功能**而非改动，本文未假设其已存在。

## 11 本轮实施记录（2026-10-14）

已实现 CLI CSI Z 解码、共享 `/mode` 状态、即时 tone 重绘；桌面普通 Composer 新增主题 token 箭头、aria-live、共享下拉状态并撤销 unrestricted consent。plan 权限选择显示 readonly。忙时切换只影响下一轮，当前运行审批使用捕获的 mode/permission。模态打开时不劫持（包括新建任务对话框，此处仍用模式下拉），审批/picker/CLI 选区/粘贴均不切换。

聚焦测试覆盖 split CSI、草稿保留、忙时 scope、picker/审批/粘贴保护，以及 Chromium mounted 输入焦点、下拉、readonly、模态及原生反向导航。未完成各真实终端/主题对比度与 Electron 视觉矩阵，不宣称全部 AC 验收。
