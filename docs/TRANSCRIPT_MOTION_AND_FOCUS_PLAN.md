# 对话区域动画、选中与焦点稳定性评估及修改计划

> 本文档针对 Forge 桌面与 Web 渲染端（`src/renderer/**`）对话区域（`Transcript`、`ToolDisclosure`、`Reasoning`、`StreamingMarkdown`、`Composer`）出现的**频繁闪烁、动画卡顿冲突、焦点环重影跳变及文本选中丢失**问题进行根因诊断，并给出分阶段修改计划与验收标准。
>
> - 关联组件：`src/renderer/components/workbench/Transcript.tsx`、`src/renderer/components/primitives/ToolDisclosure.tsx`、`src/renderer/components/primitives/StreamingMarkdown.tsx`、`src/renderer/components/workbench/Composer.tsx`
> - 关联状态：`src/renderer/state/timeline.ts`、`src/renderer/state/workbench-reducer.ts`、`src/renderer/state/transcript-sync.ts`、`src/renderer/state/transcript-scroll.ts`
> - 关联样式：`src/renderer/styles/global.css`、`src/renderer/styles/motion.css`、`src/renderer/styles/workspace-theme.css`、`src/renderer/components/workbench/transcript.css`、`src/renderer/components/primitives/tool-disclosure.css`、`src/renderer/components/workbench/app.css`
> - 设计契约：遵循 [DESIGN.md](../DESIGN.md) 温暖极简工作台规范与 `prefers-reduced-motion: reduce` 无障碍要求。

---

## 1. 问题概述

在当前对话区域的实际交互与流式运行过程中，存在以下四类明显体验问题：

1. **工具卡片与消息块频繁闪烁**：工具开始/完成或轮次结束同步快照时，已渲染的卡片与正文会瞬间消失再重新弹入，伴随突兀的绿光闪烁或整块位移。
2. **展开/收起动画生硬卡顿**：展开工具详情或历史轮次时，多层 CSS 位移与缩放动画同时叠加触发，画面出现抖动。
3. **焦点框重影与跳变**：点击或使用键盘 Tab 聚焦对话区按钮、折叠条或底部输入舱（Composer）时，出现双层焦点环（外发光 + 内轮廓）或边框颜色在多套规则间闪烁。
4. **流式生成与交互时选中丢失、视口抖动**：在模型流式输出或工具执行期间难以稳定选中复制文本，输入舱打字或展开详情时滚动视口出现二次跳动。

---

## 2. 核心根因诊断

### 2.1 实时态 → 持久态切换导致 DOM 卸载重挂载（闪烁与选中丢失的头号原因）

#### (1) 工具调用 Timeline Item Key 突变引发卸载重建
- **代码位置**：`src/renderer/state/timeline.ts:211`、`src/renderer/state/timeline.ts:316`
- **触发链路**：
  1. 运行期间收到实时 `tool_started` 事件时，`buildTimeline` 在末尾追加临时工具项，赋予 `id: "live:${index}:${event.call.id}"`（第 316 行）。
  2. 紧接着 `tool_started` / `tool_finished` 触发 `refreshSession`（见 `src/renderer/state/refresh-events.ts:13-19`），拉取最新持久化 `SessionSnapshot`。
  3. 快照中的 `snapshot.messages` 已包含该 assistant `tool_calls`，此时 `buildTimeline` 为同一工具调用生成的 ID 变为 `id: "tool:${index}:${call.id}:${occurrence}"`（第 211 行）。
- **后果**：
  `Transcript.tsx:489` 将 `key={item.id}` 传给 `<ToolDisclosure>`。由于 `live:...` 变成了 `tool:...`，React 直接**卸载旧组件实例并挂载新 DOM 节点**：
  - 重新触发 `.tool-disclosure` 的 `tool-card-appear` 入场动画（含 65% 处翡翠绿阴影闪光与 `translateY(8px)`）；
  - 重新触发 `.tool-disclosure-body` 的展开动画；
  - 丢失用户在工具运行期间手动展开/收起的 `expanded` 状态、内部滚动位置、键盘焦点以及已拖选的文本。

#### (2) 轮次完成时 `ExecutionProcess` 树结构突变
- **代码位置**：`src/renderer/components/workbench/Transcript.tsx:188-228`、`473-514`
- **触发链路**：
  1. 当轮次尚在运行、未产生最终回复（`finalEntry === undefined`）时，`<ExecutionProcess execution={undefined}>` 直接返回 `<> {children} </>`，所有工具块平铺在 `.transcript-turn-body` 下。
  2. 一旦本轮结束产生最终回复，`finalEntry` 存在，`ExecutionProcess` 切换为渲染 `<div className="transcript-execution">`，且内部 `useState(false)` 默认将过程收起（`expanded = false`），同时 `finalEntry` 被移到 `ExecutionProcess` 外部渲染。
  3. 当用户点击展开 `.transcript-execution-summary` 时，`ExecutionProcess` 内部又渲染了一个 `<div className="transcript-turn-body">`（第 225 行），再次触发 `transcript-turn-expand` 下滑动画。
- **后果**：轮次结束瞬间，DOM 层级发生重排，过程区突然折叠卸载，展开时又二次播放整轮入场动画。

#### (3) 流式思考块（`streamingReasoning`）在快照同步后未及时去重
- **代码位置**：`src/renderer/state/workbench-reducer.ts:298-305`、`src/renderer/components/workbench/Transcript.tsx:717-729`
- **触发链路**：
  `SET_ACTIVE_SNAPSHOT` 在 `liveSaved` 为真时清空了 `streamingText`，避免正文重复显示；但 `streamingReasoning` 一直保留到 `run_finished` 事件才清空。当快照中的 assistant 消息已经持久化了 `reasoning` 字段时，`StoredTranscript` 内部会渲染一个持久态 `<Reasoning>`，而 `Transcript` 尾部仍同时挂载着 `run.streamingReasoning` 对应的 `<Reasoning>`。
- **后果**：在快照刷新到 `run_finished` 之间的窗口期内，同一段思考摘要在屏上出现两份，随后尾部那份在 `run_finished` 时卸载，造成垂直布局跳动。

---

### 2.2 多层 CSS 动画叠加、覆盖与重触发（动画不够平滑）

#### (1) `ToolDisclosure` 三层入场动画叠罗汉与主题色冲突
- **代码位置**：
  - `src/renderer/components/primitives/tool-disclosure.css:21-41`（`.tool-disclosure` 的 `tool-card-appear`）
  - `src/renderer/components/primitives/tool-disclosure.css:281-318`（`.tool-disclosure-body` 的 `tool-body-slide-down` 与子项 `tool-section-reveal`）
  - `src/renderer/components/primitives/tool-disclosure.css:627-637`（`.tool-terminal-card` 的 `tool-terminal-reveal`）
  - `src/renderer/styles/motion.css:102-115`（`.tool-disclosure-body` 的 `tool-body-enter`）
- **问题详情**：
  1. `tool-card-appear` 在 65% 关键帧硬编码了 `box-shadow: 0 0 0 1px var(--accent-sage, #10b981), 0 4px 16px rgba(16, 185, 129, 0.15)`，翡翠绿发光与当前温暖米白/陶土色主题（`--accent: #a54f35`）格格不入，且在卡片重建时反复闪光。
  2. 展开工具详情时，父容器 `.tool-disclosure-body` 执行下滑动画，直接子元素 `.tool-disclosure-body > *` 同时执行带 `35ms` / `70ms` 延迟的 `tool-section-reveal` 位移动画，内部的 `.tool-terminal-card` 又同时执行 `tool-terminal-reveal` 缩放位移动画。三层嵌套 `transform` + `opacity` 叠加，视觉上显得繁琐且有卡顿感。
  3. `.tool-disclosure` 与 `.tool-disclosure-body` 常驻声明了 `will-change: opacity, transform`，在长会话包含数十个工具卡片时会创建过多合成层，增加显存与重绘开销。

#### (2) `.transcript-turn-body` 无条件播放展开动画
- **代码位置**：`src/renderer/components/workbench/transcript.css:211-229`
- **问题详情**：
  `.transcript-turn-body` 直接绑定了 `animation: transcript-turn-expand 0.32s cubic-bezier(0.16, 1, 0.3, 1) both`（从 `opacity: 0; translateY(-8px)` 到 `1 / 0`）。这意味着不仅用户手动展开折叠轮次时会动画，**首次加载会话、切换会话、新开启一轮对话**时，所有轮次主体都会无条件播放一次下滑淡入。

#### (3) 流式光标随 Markdown 块切换不断重启
- **代码位置**：`src/renderer/styles/motion.css:225-237`、`src/renderer/components/primitives/StreamingMarkdown.tsx:9`
- **问题详情**：
  流式光标通过 `.message-streaming .markdown-content > :last-child:not(.markdown-code):not(.markdown-table-scroll)::after` 挂载在最后一个块级节点上。流式期间每 80ms 重新解析 Markdown，当模型输出换行生成新 `<p>`、`<li>` 或切入代码块时，`:last-child` 对应的 DOM 元素发生改变，`wb-caret-blink` 动画从 `0%` 重新开始，且在代码块出现/闭合时突然消失又重现，观感上像一直在闪烁。

---

### 2.3 焦点环（Focus Ring）双重绘制与输入舱焦点冲突

#### (1) 全局 `box-shadow` 与组件 `outline` 叠加形成双焦点环
- **代码位置**：
  - 全局基础规则：`src/renderer/styles/global.css:49-52`
    ```css
    :focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--focus-ring);
    }
    ```
  - 组件局部规则：
    - `src/renderer/components/workbench/transcript.css:88-91`（`.reasoning-done .reasoning-head:focus-visible`：`outline: 2px solid var(--focus-ring); outline-offset: -2px;`）
    - `src/renderer/components/workbench/transcript.css:205-208`（`.transcript-turn-toggle:focus-visible`：`outline: 2px solid var(--focus-ring); outline-offset: 1px;`）
    - `src/renderer/components/workbench/transcript.css:268-271`（`.transcript-turn-collapsed-bar:focus-visible`）
    - `src/renderer/components/workbench/transcript.css:335-338`（`.transcript-execution-summary:focus-visible`）
    - `src/renderer/components/primitives/tool-disclosure.css:79-82`（`.tool-disclosure-header:focus-visible`：`outline: 2px solid var(--focus-ring); outline-offset: -1px;`）
    - `src/renderer/components/primitives/tool-disclosure.css:431-434`、`804-807`、`840-843`（`.tool-copy`、`.tool-output-toggle`、`.tool-debug-summary`）
    - `src/renderer/components/workbench/app.css:358-361`（`.message-copy:focus-visible`）
- **问题详情**：
  所有组件级 `:focus-visible` 只声明了 `outline`，**未声明 `box-shadow: none`**。因此当这些按钮获得 `:focus-visible` 时，浏览器同时渲染全局的 `box-shadow: 0 0 0 2px var(--focus-ring)` 和组件的 `outline: 2px solid var(--focus-ring)`（且带有 `-1px` / `-2px` / `1px` 偏移），两条环叠在一起形成厚重模糊的双重边框；若组件同时带 `transition: all` 或 `box-shadow` 过渡，聚焦与失焦瞬间就会出现明显的闪烁。

#### (2) 输入舱（`.composer-surface`）三处 `:focus-within` 规则互相覆盖
- **代码位置**：
  1. `src/renderer/components/workbench/app.css:857-878`：`transition: all var(--transition-fast)`，`.composer-surface:focus-within { border-color: var(--border-hover); box-shadow: var(--shadow-composer); }`
  2. `src/renderer/styles/motion.css:180-188`：`.composer-surface:focus-within { border-color: var(--accent-sage); box-shadow: var(--shadow-composer), 0 0 0 1px var(--accent-sage); }`
  3. `src/renderer/styles/workspace-theme.css:158-166`：`.wb-app .composer-surface:focus-within { border-color: var(--border-hover); box-shadow: var(--shadow-composer); }`，并仅对 `.wb-app .composer-surface:has(.composer-textarea:focus-visible)` 设置 `border-color: var(--focus-ring)`。
- **问题详情**：
  由于样式表导入顺序与选择器优先级（`.wb-app .composer-surface` 高于 `.composer-surface`），三处规则对 `border-color`、`box-shadow` 和 `transition` 的定义互相冲突。当用户从输入框点击底部工具栏（模型选择、思考等级、模式下拉、发送按钮）或弹窗关闭返回焦点时，焦点在 `.composer-textarea` 与子按钮之间转移，卡片外框颜色和阴影在不同状态间跳变闪烁。

#### (3) `transition: all` 放大焦点与悬停重绘
- **代码位置**：`src/renderer/components/workbench/app.css:863`、`928` 等多处使用了 `transition: all var(--transition-fast)`。
- **问题详情**：`transition: all` 会连同 `outline`、`box-shadow`、`padding`、`width` 一起做插值过渡，在焦点切换或布局微调时引发非预期的视觉拖影与闪动。

---

### 2.4 自动跟随滚动时机错位与输入框重排抖动（Layout Thrashing）

#### (1) 流式输出 `contentVersion` 同步滚动与 80ms 节流渲染脱节
- **代码位置**：`src/renderer/components/workbench/Transcript.tsx:611`、`641-660`；`src/renderer/components/primitives/StreamingMarkdown.tsx:9-33`
- **问题详情**：
  1. `Transcript.tsx:611` 在每次渲染时把完整的 `run?.streamingReasoning` 和 `run?.streamingText` 拼接进 `contentVersion` 字符串。
  2. 每当 `text_delta` 到达，`contentVersion` 立即变化，`useLayoutEffect([contentVersion])`（第 641 行）同步执行 `scroll.scrollTop = scroll.scrollHeight`。但此时子组件 `StreamingMarkdown` 处于 80ms `setTimeout` 节流窗口内，**DOM 内容尚未更新**，这次滚动实际上滚的是旧高度。
  3. 80ms 后 `StreamingMarkdown` 更新 `displayed` 状态并撑高 DOM，触发 `ResizeObserver`（第 652 行），异步再次设置 `scroll.scrollTop = scroll.scrollHeight`。
  4. 此外，点击展开/收起工具条或轮次时，`.workbench-conversation-scroll` 缺少显式的滚动锚定保护，展开收起大块输出时焦点行容易跳离鼠标位置。

#### (2) `useAutosizePrompt` 每次按键强制归零高度引发同步回流
- **代码位置**：`src/renderer/components/workbench/useAutosizePrompt.ts:19-30`
- **问题详情**：
  每次 `value` 变化（用户每敲一个字符）时，`useLayoutEffect` 先执行 `input.style.height = "0px"`，紧接着读取 `input.scrollHeight` 并赋回 `input.style.height = "${next}px"`。
  这不仅在每次按键时触发强制同步布局（Forced Synchronous Layout），而且在多行输入或窗口变化时容易引发底部 sticky 输入舱微幅抖动，进而触发上方 `.workbench-conversation-scroll` 的 `ResizeObserver`。

---

## 3. 分阶段修改计划

### 阶段 1：稳定时间线 Key 与流式→持久态无缝交接（消除 DOM 重建闪烁）

1. **统一 `timeline.ts` 中工具调用的稳定 ID**（`src/renderer/state/timeline.ts`）
   - **修改点**：将工具项的 `id` 生成规则统一为基于工具调用自身标识与在当前会话中的出现序号，例如：
     ```ts
     // 无论来自 snapshot.messages 还是实时 tool_started 事件，同一工具调用使用相同格式的稳定 ID
     id: `tool:${call.id}:${occurrence}`
     ```
   - **在实时 `tool_started` 支路中**：计算该 `event.call.id` 在当前已表示及实时队列中的 `occurrence`，生成相同的 `tool:${event.call.id}:${occurrence}`。
   - **效果**：当 `refreshSession` 将实时工具同步为持久消息时，React 发现 `key` 完全一致，**原位更新同一个 `<ToolDisclosure>` 实例**，不再卸载重建 DOM，彻底消除工具卡片二次闪光、动画重播与选中/焦点丢失。

2. **同步清理已落盘的 `streamingReasoning`**（`src/renderer/state/workbench-reducer.ts`、`src/renderer/state/transcript-sync.ts`）
   - **修改点**：在 `SET_ACTIVE_SNAPSHOT` 分支（`src/renderer/state/workbench-reducer.ts:289-305`）中，复用 `reasoningSaved(action.snapshot, currentRun.streamingReasoning)` 判定：当持久快照已经包含本轮思考内容时，与 `streamingText` 一并清理 `streamingReasoning`（及 `reasoningTruncated`）。
   - **效果**：消除持久消息 `<Reasoning>` 与尾部流式 `<Reasoning>` 短暂并存导致的重复渲染与高度跳变。

3. **移除 `ExecutionProcess` 内部重复的入场动画类名**（`src/renderer/components/workbench/Transcript.tsx`）
   - **修改点**：将 `ExecutionProcess`（第 225 行）展开容器的类名从 `.transcript-turn-body` 改为专用布局类 `.transcript-execution-items`（仅保留 `display: flex; flex-direction: column; gap: 10px; width: 100%`，不带无条件位移动画）。

---

### 阶段 2：收敛与去重 CSS 动画体系（消除叠加抖动与异色闪光）

1. **精简 `ToolDisclosure` 入场与展开动效**（`src/renderer/components/primitives/tool-disclosure.css`、`src/renderer/styles/motion.css`）
   - **移除绿光闪烁与常驻 `will-change`**：
     在 `tool-disclosure.css:8-41` 中，去掉 `tool-card-appear` 关键帧里 65% 处的翡翠绿 `box-shadow`（`rgba(16, 185, 129, 0.15)`）和常驻的 `will-change: opacity, transform`，改为安静的 140ms 透明度微过渡（或仅在新增行时轻量淡入）。
   - **去重 `.tool-disclosure-body` 展开动画**：
     移除 `tool-disclosure.css:281-318` 中的 `tool-body-slide-down`、`scaleY(0.95)`、`.tool-disclosure-body > *` 逐项延迟动画（`tool-section-reveal`）以及 `tool-terminal-reveal`（第 627 行）；统一由 `motion.css:102-115` 的轻量 `tool-body-enter`（`140ms`，仅 `opacity: 0 -> 1` 与 `translateY(-3px -> 0)`）驱动。
   - **效果**：工具展开从「三层嵌套错位抖动」变为干净利落的单次轻量过渡。

2. **收敛轮次与消息入场动画**（`src/renderer/components/workbench/transcript.css`、`src/renderer/styles/motion.css`）
   - **移除 `.transcript-turn-body` 的无条件入场动画**（`transcript.css:216`）：历史轮次与切换会话直接静态渲染，不播放整屏下滑动画。
   - **约束 `.message-assistant:last-child` 入场动画**（`motion.css:118-132`）：避免流式草稿（`.message-streaming`）转为已保存消息（`.message-assistant`）时因去掉 `.message-streaming` 类名而突然触发 `message-arrival` 上浮动画，真正落实 [DESIGN.md §11.4](../DESIGN.md)「草稿 → 保存零跳动」。

3. **稳定流式光标表现**（`src/renderer/styles/motion.css:225-247`）
   - 将光标闪烁调整为柔和的透明度过渡，并确保在段落切换时不会引起行高或盒模型尺寸变化。

---

### 阶段 3：统一焦点环（Focus Ring）与选中稳定性（消除双层焦点框与边框跳变）

1. **统一全局与局部 `:focus-visible` 规范**（`src/renderer/styles/global.css` 及各组件样式）
   - **修改点**：在 `src/renderer/styles/global.css:49-52` 中将全局默认焦点环统一为 `outline` 方案：
     ```css
     :focus-visible {
       outline: 2px solid var(--focus-ring);
       outline-offset: 2px;
       box-shadow: none;
     }
     ```
   - 同时检查并清理对话区各控件（`.tool-disclosure-header`、`.reasoning-head`、`.transcript-turn-toggle`、`.transcript-execution-summary`、`.message-copy`、`.usage-trigger` 等）的 `:focus-visible`，确保只存在**唯一一层 2px 焦点环**，无 `box-shadow` 与 `outline` 重影。

2. **收敛 Composer 输入舱 `:focus-within` 与过渡属性**（`src/renderer/components/workbench/app.css`、`src/renderer/styles/motion.css`、`src/renderer/styles/workspace-theme.css`）
   - **修改点**：
     - 将 `.composer-surface` 和 `.composer-dropdown-trigger` 上的 `transition: all var(--transition-fast)` 替换为显式属性：`transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast)`。
     - 删除 `motion.css:185-188` 中与 `workspace-theme.css:158-166` 冲突的 `.composer-surface:focus-within` 规则，保留 `workspace-theme.css` 作为唯一权威定义：
       - `.wb-app .composer-surface:focus-within` 使用平稳的 `border-color: var(--border-hover)`；
       - `.wb-app .composer-surface:has(.composer-textarea:focus-visible)` 使用 `border-color: var(--focus-ring)`；
       - 内部按钮键盘聚焦时由按钮自身显示 2px `:focus-visible` 环，外层卡片不跳变双框。

3. **保护对话区文本选区与组件引用稳定**
   - 检查 `Transcript.tsx` 中 `renderTimelineEntry` 及工具参数切片，结合阶段 1 的稳定 Key，确保运行事件更新不会销毁已渲染的历史消息与工具 DOM，保护用户正在拖选的文本选区。

---

### 阶段 4：优化自动跟随滚动与输入框高度计算（消除布局抖动）

1. **轻量化 `contentVersion` 并对齐流式跟随滚动**（`src/renderer/components/workbench/Transcript.tsx`）
   - **修改点**：
     - 将 `contentVersion`（第 611 行）中的 `${run?.streamingReasoning ?? ""}:${run?.streamingText ?? ""}` 改为记录长度 `${run?.streamingReasoning?.length ?? 0}:${run?.streamingText?.length ?? 0}`，避免每次渲染拼接数十 KB 的大字符串。
     - 当 `StreamingMarkdown` 节流更新实际改变 `.conversation-inner` 高度时，由 `ResizeObserver` 在 `navigation.current.following` 为真时紧贴底部，避免在 DOM 尚未更新前做无效的二次跳转。
     - 在展开/收起披露项（`inspectDisclosure`）时，保持当前视口锚点稳定，不发生跳动。

2. **无抖动自适应输入框高度**（`src/renderer/components/workbench/useAutosizePrompt.ts`）
   - **修改点**：
     - 避免在每次输入时无条件将 `input.style.height = "0px"` 造成容器高度瞬间塌缩再撑开；只在文本内容或可用宽度变化时测量目标高度，且仅当计算的 `nextHeight` 与当前高度不一致时才写入 `input.style.height` 与 `input.style.overflowY`。

---

## 4. 涉及修改的文件清单

| 阶段 | 文件路径 | 主要改动内容 |
| --- | --- | --- |
| 阶段 1 | `src/renderer/state/timeline.ts` | 统一实时事件与持久消息的工具项 `id`，消除 `live:` → `tool:` Key 突变 |
| 阶段 1 | `src/renderer/state/workbench-reducer.ts` | `SET_ACTIVE_SNAPSHOT` 中同步清理已落盘的 `streamingReasoning` |
| 阶段 1 | `src/renderer/components/workbench/Transcript.tsx` | 平滑化 `ExecutionProcess` 展开容器类名，精简 `contentVersion` |
| 阶段 2 | `src/renderer/components/primitives/tool-disclosure.css` | 移除 `tool-card-appear` 绿光闪烁、常驻 `will-change` 及多层叠加的子项入场动画 |
| 阶段 2 | `src/renderer/components/workbench/transcript.css` | 移除 `.transcript-turn-body` 无条件入场动画 |
| 阶段 2 | `src/renderer/styles/motion.css` | 统一单层轻量工具展开动画、修正流式转持久态消息的重复入场动画 |
| 阶段 3 | `src/renderer/styles/global.css` | 将全局 `:focus-visible` 统一为 `outline` 并清除 `box-shadow` 重影 |
| 阶段 3 | `src/renderer/components/workbench/app.css` | 替换 `transition: all` 为明确属性过渡，清理重复 `.composer-surface:focus-within` |
| 阶段 3 | `src/renderer/styles/workspace-theme.css` | 统一输入舱 `:focus-within` 与 `:has(.composer-textarea:focus-visible)` 边框表现 |
| 阶段 4 | `src/renderer/components/workbench/useAutosizePrompt.ts` | 按需更新输入框高度，避免每次按键先置 `0px` 触发同步重排抖动 |

---

## 5. 验证与验收标准

1. **工具调用全周期零闪烁**：
   - 发起包含 `run_command`、`read_file`、`edit_file` 的对话，在 `tool_started` → `tool_finished` → `refreshSession` → `run_finished` 全过程中，工具卡片 DOM 节点保持同一实例（不卸载重建、不闪绿光、不重播下滑动画）。
   - 工具运行期间手动展开或收起卡片，状态更新后手动选择保持不变，卡片内已选中的文本不丢失。
2. **草稿 → 保存零跳动**：
   - 流式思考（`Reasoning`）与流式正文（`StreamingMarkdown`）在快照同步和运行结束时平滑过渡为持久态，不出现双份思考块，也不重新触发 `.message-assistant` 上浮动画。
3. **单一清晰焦点环**：
   - 使用键盘 Tab 遍历对话区的思考摘要、轮次折叠按钮、工具标题栏、复制按钮、用量条及 Composer 内部控件，每个聚焦元素仅显示唯一一层清晰的 2px `--focus-ring`，无 `box-shadow` + `outline` 双重边框。
   - 在 Composer 输入框与工具栏按钮间切换焦点时，外层卡片边框平滑过渡，不出现多颜色跳变。
4. **单元测试与无障碍回归**：
   - 现有测试套件（特别是 `tests/renderer/timeline.test.ts`、`tests/renderer/reasoning-mounted.test.ts`、`tests/renderer/transcript-*.test.ts`）全部通过。
   - 开启 `prefers-reduced-motion: reduce` 时，所有位移与过渡动画归零，功能与可读性完全正常。
