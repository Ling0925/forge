# Forge 前端架构分析与优化实施方案

> 本文档针对 Forge 桌面与 Web 渲染端（`src/renderer/**`）的现状进行系统性技术分析，对标 [DESIGN.md](../DESIGN.md) 视觉契约与高标准编码助手（Cursor、Windsurf、Claude Desktop）的交互标杆，提供清晰、模块化、可直接分步实施的技术规格说明。

---

## 1. 范围与约束契约

1. **核心文件范围**：
   - 状态层：`src/renderer/state/**`
   - 组件层：`src/renderer/components/workbench/**`、`src/renderer/components/primitives/**`
   - 样式层：`src/renderer/styles/**`
   - 测试集：`tests/renderer/**`
2. **绝对约束**：
   - **零重型外部 UI 库**：不引入 AntD、MUI、Tailwind 或外部庞大组件树，严格遵循纯 CSS + CSS 变量设计令牌（Tokens）。
   - **双宿主透明同构**：所有改动必须同时保证在 Electron（`preload.ts` 暴露 `window.forge`）与标准浏览器 Web Dev 模式（`src/renderer/web-host.ts` 垫片）下 100% 行为一致。
   - **Light-First 极简美学**：遵守 [DESIGN.md](../DESIGN.md) 中的去边框化、米白与暖灰底色（`#fdfdfb` / `#f6f6f2`）、鼠尾草绿（`#55684d`）及 760px~780px 居中阅读行宽。

---

## 2. 现状优势与现存体验/性能缺口

### 2.1 架构优势
1. **轻量与高响应度**：整体仅依赖 React 19、React Markdown、Phosphor Icons，加载几乎零耗时。
2. **严密的通信桥接**：`window.forge` 契约清晰，桌面与 Web 模式解耦彻底。
3. **高标准安全与无障碍**：外链 CSP 强制清洗、图片拦截保护、全局快捷键防焦点迷失（Focus restoration）。
4. **完善的基础单测**：已积累 36+ 针对转录、审批、草稿存储与无障碍焦点的单元测试。

### 2.2 核心痛点与性能缺口
1. **高频流式输出引发全树无效重渲染（Context Slicing 缺失）**：
   - `useWorkbench()` 在 `workbench-context.tsx` 中将低频的会话列表、配置、工作区与高频的 `activeRuns[sessionId].streamingText` 绑定在同一个 Context。AI 每流式吐出一个 Token，`Sidebar`、`Composer`、`Inspector`、`App` 就会全量重渲染。
2. **输入舱（`Composer.tsx`）代码膨胀（658 行巨石组件）**：
   - 混合了草稿本地持久化、高度自适应计算、权限下拉、工作区选择浮层、模型与思考强度滑块、发送快捷键等多种职责，缺乏子模块边界。
3. **缺乏编码 Agent 必备的高频快捷操作**：
   - **斜杠命令缺失**：CLI 拥有完整的 `/clear`、`/model`、`/permissions` 等命令，GUI Composer 键入 `/` 毫无反应，用户必须打断打字流用鼠标点击。
   - **文件与符号引用（`@` Mentions）缺失**：无法在 Composer 中快速联想并引用项目中的文件路径。
   - **文件拖拽（Drag & Drop）缺失**：无法直接把工作区文件或外部路径拖入输入框。
4. **Diff 查看器（`DiffViewer.tsx`）交互单一**：
   - 仅支持单栏 Unified Diff，宽屏桌面下无法利用屏幕宽度进行 Side-by-Side 双栏对比，且无法就地展开被跳过的上下文块（Hunk Gaps）。
5. **长会话转录区 DOM 堆积与 Markdown 重复解析**：
   - 随着历史事件增长，`StoredTranscript` 完整渲染全部 DOM 节点；`StreamingMarkdown` 虽然节流 80ms，但每次都全量重走一遍 remark-gfm AST 解析。

---

## 3. 具体优化方案与技术规格

### 优化 1：状态分层与 Context Slicing（根治流式卡顿）

#### 目标
将**高频流式状态**（Token 输出、Reasoning 增量、实时用量）与**低频结构状态**（会话列表、全局配置、弹窗控制、工作区）拆分为独立的 Context，阻断打字流向整个界面的扩散。

#### 模块设计
在 `src/renderer/state/` 下拆分出：
- `workbench-context.tsx`（保留低频会话元数据与静态操作）
- `run-stream-context.tsx`（新增：专门管理 `activeRuns`、`streamingText`、`streamingReasoning`）

```typescript
// src/renderer/state/run-stream-context.tsx 接口规格
export interface RunStreamState {
  readonly [sessionId: string]: {
    readonly runId?: string;
    readonly status: RunStatus;
    readonly streamingText: string;
    readonly streamingReasoning?: string;
    readonly pendingOutputs: readonly PendingOutput[];
    readonly pendingApproval?: ApprovalRequest;
  };
}

export function useSessionStream(sessionId: string | null) {
  // 仅在指定 sessionId 的流式数据变化时触发重渲染
}
```

#### 关键组件 Memo 边界
在以下组件外层包裹 `React.memo` 并优化 props：
1. `Sidebar`（仅依赖 `sessions`、`activeSessionId`、`workspaces`，不受 Token 流影响）
2. `Composer`（仅依赖 `activeSessionId`、`settings`、`permission`，不受 Token 流影响）
3. `Inspector`（仅在审批事件或展开状态改变时渲染，折叠期间断开高频监听）

---

### 优化 2：Composer 巨石组件重构与解耦

#### 目标
将 `Composer.tsx` (658 行) 拆分为清晰的原子子组件，置于 `src/renderer/components/workbench/composer/` 目录下。

#### 拆分结构
```text
src/renderer/components/workbench/composer/
├── Composer.tsx             # 容器层：负责组装与键盘总线
├── ComposerInput.tsx        # 纯输入层：Textarea、Autosize、草稿联动、按键拦截
├── ComposerWorkspaceBar.tsx # 工作区徽章、路径悬浮提示与工作区切换对话框
├── ComposerControls.tsx     # 底部工具栏：权限徽章、模型选择器、用量卡片、发送/停止按钮
└── useComposerShortcuts.ts  # 纯逻辑 Hook：Enter / Shift+Enter / Cmd+Enter / Esc
```

#### 数据流动契约
- 状态隔离：输入文字 `prompt` 完全由 `ComposerInput` 本地状态受控，仅在 `blur` 或按键时写入 `sessionStorage` 草稿，杜绝每次击键触发父级大组件刷新。
- 对外暴露清晰的 `onSubmit(prompt: string)` 与 `onCancel()` 回调。

---

### 高度生产力优化 3：GUI Composer 斜杠命令面板（`/` Slash Menu）

#### 目标
在用户于空行或开头键入 `/` 时，就地呼出轻量命令浮层，支持全键盘操控，实现与 CLI `/` 命令对齐的极速工作流。

#### 命令集契约
| 命令 | 别名 | 功能与交互说明 |
| :--- | :--- | :--- |
| `/clear` | `/c` | 开启新会话或重置当前草稿 |
| `/model` | `/m` | 直接唤起模型与思考等级选择浮层 |
| `/permissions` | `/p` | 循环切换当前会话权限：`readonly` → `workspace` → `unrestricted` |
| `/checkpoint` | `/cp` | 打开右侧检查面板并跳转至“检查点与文件还原”页签 |
| `/settings` | `/,` | 打开全局设置弹窗 |

#### 交互规范
- **触发**：当输入框光标位于第一行开头或换行后以 `/` 开头时激活。
- **键盘导航**：`ArrowUp` / `ArrowDown` 移动焦点，`Enter` / `Tab` 确认执行，`Escape` 或按空格退出菜单。
- **无障碍**：浮层具有 `role="listbox"` 与 `aria-activedescendant` 属性。

---

### 生产力优化 4：`@` 文件/符号智能引用与文件拖拽

#### 目标
输入 `@` 时列出当前工作区文件列表，支持拼音与模糊检索；支持将系统或编辑器中的文件直接拖入输入区。

#### 核心实现规格
1. **文件清单获取**：
   - 依赖现有 IPC `window.forge.listWorkspaceFiles(workspace)`（或复用项目资源索引）；
   - 建立 LRU 缓存与轻量前缀树，避免重复遍历大目录。
2. **输入框补全交互**：
   - 键入 `@` + 关键字（如 `@src/app`），出现匹配下拉列表；
   - 回车选定后，自动替换为绝对路径或相对路径（如 `` `src/app.tsx` ``），光标自动移至后方并补空格。
3. **拖拽支持（Drop Zone）**：
   - 给 `Composer` 根容器绑定 `onDragOver`、`onDragLeave` 与 `onDrop` 事件；
   - 当检测到 `event.dataTransfer.files` 时，提取文件路径或向输入框插入被拖入文件的路径，输入框边框浮现鼠尾草绿轻微高亮（`--accent-sage` 虚线或软阴影）。

---

### 优化 5：DiffViewer 增强（Side-by-Side 双栏对比与跳跃折叠）

#### 目标
提升代码审查体验，使 `DiffViewer.tsx` 在桌面大屏下支持双栏视图，且能够就地展开折叠的代码行。

#### 界面与功能规格
1. **视图模式切换**：
   - 在 Diff 头部提供切换按钮：`单栏 (Unified)` 与 `分栏 (Split)`。
   - 窗口宽度 `< 900px` 时强制单栏模式；`≥ 900px` 时默认允许用户自由切换并持久化偏好。
2. **未修改块展开（Expandable Hunk Gaps）**：
   - 当前针对跳过的代码仅展示为 `{ skipped: N }` 的静态行；
   - 升级：点击 gap 行时，允许就地展开上下 20 行未修改代码，方便用户理解修改发生的上下文。
3. **语法高亮增强**：
   - 基于现有 `src/renderer/state/code-highlight.ts`，为 Diff 中的新增与删除代码应用轻量语法着色，提升可读性。

---

### 优化 6：多子代理（Sub-Agent）树状结构可视化

#### 目标
消除子代理执行时的“黑盒感”，在主对话与检查器中清晰呈现父子任务拓扑。

#### 展示层级规范
1. **Transcript 消息流**：
   - 当收到 `subagent_spawned` 或 `subagent_finished` 事件时，不单纯展示为灰底日志文本；
   - 封装为 **SubAgentDisclosure** 卡片：展示子代理 ID、分配的模型（如 `cbcn/deepseek-v4.1-flash`）、明确的 `ownership` 独占修改路径，以及当前运行阶段（Thinking / Editing / Verifying）。
2. **Inspector 联动**：
   - 点击卡片右上角“查看详情”，在右侧 Inspector 打开专用的 Sub-Agent 视图，可以独立翻阅该子代理的工具调用与返回证据，主任务界面保持清爽。

---

### 优化 7：上下文窗口用量预警与空状态 Starter 引导

#### 1. 上下文用量三色健康度指示
- 在 `UsagePopover` 触发器或状态条上：
  - `< 70%`：低调中性灰，不打扰阅读。
  - `70% ~ 85%`：柔和橙色提示（`--warning`），微标标明“上下文已用 78%”。
  - `> 85%`：醒目警告色（`--error`），提供一键操作按钮：“新开任务并注入上下文摘要”。

#### 2. Welcome 空状态智能 Starter
- `Welcome.tsx` 目前为静态说明；
- 优化：读取当前工作区根目录特征：
  - 发现 `package.json`：展示“运行全量测试”、“审查未提交修改”、“分析代码质量”3 个快捷气泡；
  - 发现 `Cargo.toml`：展示“cargo check 并排查告警”、“分析模块依赖”；
  - 点击气泡直接填入 Composer 并将焦点置入输入框，大幅缩短首轮交互时间。

---

## 4. 实施阶段与排期路线表

| 阶段 | 任务目标 | 核心改动文件 | 验收标准与测试保障 |
| :--- | :--- | :--- | :--- |
| **Phase 0**<br>（性能与解耦） | 1. 拆分 `Composer.tsx` 为原子子目录组件<br>2. 剥离 `RunStreamContext`，为 `Sidebar`/`Composer` 增加 Memo 边界 | `src/renderer/state/workbench-context.tsx`<br>`src/renderer/state/run-stream-context.tsx`<br>`src/renderer/components/workbench/composer/**` | - 单元测试：`tests/renderer/composer-*.test.ts` 全部通过<br>- 验证：连续流式文本输出期间，`Sidebar` 渲染计数为 0 |
| **Phase 1**<br>（生产力增强） | 1. 实现 Composer `/` 斜杠命令浮层与快捷设置<br>2. 实现 `@` 文件模糊匹配与路径回填<br>3. 实现外部文件拖拽进 Composer | `src/renderer/components/workbench/composer/SlashMenu.tsx`<br>`src/renderer/components/workbench/composer/FileMention.tsx`<br>`src/renderer/styles/composer-activity.css` | - 新增 `tests/renderer/composer-slash-menu.test.ts`<br>- 验证键盘上/下/回车可精准选中命令，Tab 补全有效 |
| **Phase 2**<br>（深度体验） | 1. `DiffViewer` 增加 Side-by-Side 双栏对比与 Gap 展开<br>2. 完善 SubAgent 卡片树状可视化<br>3. 上下文超限预警与 Welcome 智能 Starter | `src/renderer/components/primitives/DiffViewer.tsx`<br>`src/renderer/components/workbench/SubAgentDisclosure.tsx`<br>`src/renderer/components/workbench/Welcome.tsx` | - 新增 `tests/renderer/diff-viewer-split.test.ts`<br>- 验证宽屏下可自由切换双栏与单栏，样式不溢出 |

---

## 5. 开发者与子代理提示（Prompting Guide）

若指派子代理或外部快速模型实现具体功能，建议**每次只挑选一个原子任务**并使用如下指令结构：

```markdown
请按照 docs/FRONTEND_IMPROVEMENTS.md 中的 Phase 0 规范：
1. 仅针对 Composer 巨石组件进行解耦，在 src/renderer/components/workbench/composer/ 下拆分出 ComposerInput、ComposerWorkspaceBar 与 ComposerControls；
2. 保持原有所有 props 行为、sessionStorage 草稿存储与 autosize 功能完全兼容；
3. 不引入任何外部 UI 依赖，使用现有设计令牌与 CSS 文件；
4. 运行 pnpm vitest run tests/renderer/ 确认既有测试全部通过，并补充拆分后组件的针对性测试。
```
