# Forge 会话界面 Markdown 渲染需求

本文是**会话界面 Markdown 渲染**的需求文档，覆盖桌面工作台与 CLI 终端两个入口。
它描述目标行为、现有能力、缺口与验收标准，**不是**当前已通过验收的声明。

- 适用范围：桌面会话视图（`src/renderer/components/workbench/**`）与 CLI 终端会话视图（`src/cli/render/**`、`src/cli/terminal/**`）。
- 相关契约：[DESIGN.md](../DESIGN.md)（视觉与交互）、[ARCHITECTURE.md](ARCHITECTURE.md)（渲染层职责）、[CLI.md](CLI.md)（终端行为）。
- 术语：**源文本**指模型或工具返回的 Markdown 原文；**渲染**指把源文本转换为界面可见结构。

## 1 背景与现状

会话界面已经存在 Markdown 渲染，但两个入口的实现与能力不同。本节记录**经代码核对**的现状，供需求对照。

| 入口 | 实现 | 现状 |
| --- | --- | --- |
| 桌面会话 | `react-markdown@10` + `remark-gfm@4`，见 `src/renderer/components/workbench/Markdown.tsx` | 已支持完整 GFM：标题、列表、表格、围栏代码、行内标记 |
| CLI 终端 | 自研 `MarkdownStream`，见 `src/cli/render/markdown.ts` | 仅支持标题、`-`/`*` 与 `1.` 列表、`` `行内` ``、`**粗体**`、围栏代码 |

桌面已有接线点：

- `src/renderer/components/workbench/Transcript.tsx`：历史消息（第 33 行）与流式草稿（第 167 行）均调用 `<Markdown source=… />`。
- `src/renderer/components/workbench/RuntimePanels.tsx`：计划说明、子代理任务、上下文摘要调用 `<Markdown />`。
- `src/renderer/components/primitives/CodeBlock.tsx`：多行代码块渲染（行号 + 复制），**无语法高亮**。
- 已存在测试 `tests/renderer/markdown.test.ts`，覆盖标题/列表/表格/代码与 HTML、`javascript:` URL 不执行。

## 2 目标（Goals）

1. 会话界面（桌面 + CLI）对模型与工具返回的 Markdown **始终**给出稳定、可读、安全的渲染。
2. 渲染不得改变源文本语义，也不得引入可执行内容。
3. 流式输出在长回复与高频增量下保持可用（不卡顿、不抖动）。
4. 两个入口的能力差异**显式记录**，不假装一致。

## 3 非目标（Non-Goals）

- 不引入远端渲染服务或 CDN 资源；渲染必须在本地完成。
- 不支持会执行脚本的扩展语法（如 `rehype-raw` 直通 HTML、内联 `<script>`、`on*` 属性）。
- 不在渲染层做事实推断：不解析 Markdown 清单来生成结构化任务状态（`update_plan` 才是权威状态，见 [WORKFLOWS.md](WORKFLOWS.md)）。
- 不追求与某个特定编辑器像素级一致。

## 4 功能需求

### 4.1 桌面会话（R-D 系列）

- **R-D1**：助手消息、流式草稿、计划说明、子代理任务与上下文摘要必须以 Markdown 渲染。
- **R-D2**：至少支持 GFM 以下元素：标题、有序/无序/嵌套列表、任务列表、表格、引用块、水平线、行内代码、围栏代码（含语言标注）、粗体/斜体/删除线、链接、自动链接。
- **R-D3**：围栏代码块必须渲染为 `CodeBlock`，包含语言标签、行号与复制动作；未知语言按纯文本处理，不得报错或丢内容。
- **R-D4**：围栏代码块支持语法高亮（当前缺口，见 §6.2）。
- **R-D5**：链接不得在应用内直接导航；必须经既有 `window.forge.openExternal` 通道打开，且仅允许 http/https。
- **R-D6**：流式期间未闭合的围栏代码块不得导致渲染异常；闭合后应正确转为代码块。

### 4.2 CLI 终端（R-C 系列）

- **R-C1**：终端渲染继续产出 `RichLine`/`Span` 结构，只有终端控制器可写转义序列（见 `src/cli/ui-contract.ts` 的信任模型）。
- **R-C2**：至少支持当前已实现的子集：标题（`#`~`###`）、无序/有序列表、行内代码、粗体、围栏代码。
- **R-C3**：新增语法按使用频率决定，候选为：引用块（`>`）、水平线（`---`）、表格。**每新增一项必须配对应回归测试**。
- **R-C4**：渲染必须对不可信文本做控制序列过滤（沿用 `src/cli/render/sanitize.ts` 的 `ControlFilter`），不得注入 OSC/CSI 序列。
- **R-C5**：`TERM=dumb` 与非 TTY 使用 plain 输出（见 [CLI.md](CLI.md)）。

### 4.3 流式渲染（R-S 系列）

- **R-S1**：桌面流式草稿的 Markdown 重解析必须节流（建议对齐项目既有"80ms 事件合并"先例），避免每个 delta 都重解析整串。
- **R-S2**：流式期间可降级为轻量渲染（纯文本或未高亮代码块），`run_finished` 后切换为完整渲染。
- **R-S3**：流式渲染的输入长度上限行为必须明确且不丢已提交内容（当前 reducer 有 `slice(-1000000)` 截断，见 `src/renderer/state/workbench-reducer.ts`）。

## 5 安全需求（R 系列，强制）

- **R-1**：所有 Markdown 源均为**不可信输入**（模型输出、工具输出、网页文本）。
- **R-2**：桌面渲染继续 `skipHtml`；**禁止**引入 `rehype-raw` 或任何把原始 HTML 直通的插件。
- **R-3**：外链仅允许 http/https；`externalUrlSchema`（`src/shared/ipc.ts`）为主进程与 worker 双重校验，不得放宽。
- **R-4**：CLI 渲染不得因 Markdown 内容而产生任意终端控制序列。
- **R-5**：渲染失败的降级路径必须安全：宁可显示纯文本，也不得执行或丢失内容。

## 6 缺口与候选方案

本节内容属**调研结论**，其中性能影响为代码推断，尚未实测。

### 6.1 缺口清单

| 编号 | 缺口 | 位置 | 影响 |
| --- | --- | --- | --- |
| G1 | 代码块无语法高亮 | `CodeBlock.tsx` | 观感；不属安全/正确性问题 |
| G2 | 流式整串重解析 | `Transcript.tsx` + `workbench-reducer.ts` | 长回复下潜在卡顿（推断） |
| G3 | CLI 缺表格/引用/水平线等 | `src/cli/render/markdown.ts` | 终端可读性 |

### 6.2 G1 候选方案

| 方案 | 依赖 | 说明 |
| --- | --- | --- |
| `rehype-highlight` | 新增（lowlight） | 改动最小，仅加一个 `rehypePlugins` + 主题 CSS |
| `shiki` / `react-shiki` | 较大 | 质量最高，体积最大 |
| 复用 CLI 关键字着色 | 无 | 零依赖，风格统一，维护成本高 |

**约束**：新增前端依赖须按项目约定更新 `pnpm-lock.yaml`，不得手写 lockfile；渲染端由 Vite 打包进 `dist/renderer`。

### 6.3 G2 候选方案

1. 对 `streamingText` 的 Markdown 重渲染做时间窗节流。
2. 流式期间使用轻量渲染，结算后切换完整渲染。
3. 延迟高亮未闭合围栏。

## 7 验收标准

- **AC-1**：桌面单元/静态渲染测试覆盖 GFM 元素（现有 `tests/renderer/markdown.test.ts` 需扩展至引用块、水平线、任务列表、嵌套列表）。
- **AC-2**：安全回归保留并扩展：HTML 不解释、`javascript:`/`data:` URL 不生效、外链仅走 `openExternal`。
- **AC-3**：CLI 每新增语法有对应 `tests/cli/render-v2*.test.ts` 用例。
- **AC-4**：流式长回复（如 1 万字符、数百次 delta）下不出现明显掉帧；需**实测**而非推断。
- **AC-5**：`pnpm typecheck` 与 `pnpm test` 通过（测试需终端环境，见 [CLI.md](CLI.md)）。
- **AC-6**：桌面改动后经 `vite build`/`pnpm build` 可产出，且不破坏 `electron-builder` 打包。

## 8 风险与约束

- **安全回归风险**：新增渲染插件是主要风险点，须以 R-2/R-3 为硬门槛。
- **打包风险**：新增前端依赖会改变 `dist/renderer` 产物与体积。
- **本地开发流程**：按仓库约定，CLI 改动走 `node scripts/build-core.mjs`；**渲染端改动需单独构建**，不要默认执行完整发布流程。
- **测试环境**：`pnpm test` 需要终端环境变量；当前存在 1 个既有测试回归（`tests/cli/terminal-v2-xterm.test.ts` 的 resize 用例），与本需求无关但会污染基线信号。

## 9 开放问题

1. "会话界面"最终范围是否包含 CLI 终端？若只指桌面，G3 可不做。
2. G1 是否接受新增依赖（决定体积与安装面变化）？
3. G2 的节流窗口取值，以及与既有 80ms 合并策略是否统一？
4. 流式渲染是否允许"先纯文本后 Markdown"的观感变化？

## 10 未验证项（诚实说明）

- 本文的能力与缺口均来自**源码核对**，未运行 Electron/Vite 实际渲染，未截图比对。
- G2 的性能影响为**代码推断**，未做 profiling。
- 语法高亮方案（§6.2）的体积与效果**未实测**。
- 未复核外部参考实现的具体行为，仅以本仓库代码为准。
