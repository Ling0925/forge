# Forge 前端计划（Plan）展示需求与实施规格

> 本文档定义 Forge 桌面与 Web 渲染端（`src/renderer/**`）关于 **计划（Plan / `update_plan`）** 状态可视化的产品需求与技术实现规格。
> 
> - 关联文档：[DESIGN.md](../DESIGN.md)（视觉契约）、[PLAN_PINNING_REQUIREMENTS.md](PLAN_PINNING_REQUIREMENTS.md)（CLI 计划固定规范）、[WORKFLOWS.md](WORKFLOWS.md)（Plan 核心语义）。
> - 状态定义：计划由原生核心工具 `update_plan` 产生，结构为严格的 `TaskPlan` 对象（包含 `explanation: string` 与 `steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>`），**严禁**从 Markdown 清单猜测或解析。

---

## 1. 业务背景与问题现状

### 1.1 核心价值
在大模型执行复杂的多步骤工程任务（如重构代码、多文件修改、运行测试验证）时，计划（Plan）是连接模型思考与人类监督的最关键桥梁：
- 让用户**实时感知进度**，消除等待黑盒感；
- 明确当前模型**正在执行哪一步**、**后续还有哪几步**；
- 出现问题时，能够基于计划的步骤进行精准干预或回溯。

### 1.2 现状审查（经代码核对）
1. **隐藏过深**：
   - 目前在前端，计划仅在右侧抽屉 `Inspector` 的运行时页签（`RuntimePanels.tsx:260-292`）中被渲染为一段静态列表。
   - 桌面端为了保证阅读专注度，`Inspector` 默认**折叠收起**（`inspectorCollapsed = true`）。用户若不主动展开抽屉并滚动到底部，**完全感知不到计划的存在**。
2. **对话流呈现单一**：
   - 当模型调用 `update_plan` 工具时，在主转录区（`Transcript.tsx`）中仅作为一个普通的 `ToolDisclosure` 单行折叠，参数是长串 JSON，缺乏高可读性的结构化步骤视图。
3. **输入区缺乏常驻引导**：
   - CLI 已经规划了在输入区上方固定展示当前步骤（`docs/PLAN_PINNING_REQUIREMENTS.md`），而前端的输入舱（`Composer`）上方目前仅有模式提示，缺乏常驻的计划进度条。

---

## 2. 设计目标与视觉模型

秉持 [DESIGN.md](../DESIGN.md) 的 **Light-First 温暖极简专业工作台** 语法，消除组件堆叠与机械边框感，建立**“主输入舱常驻进度 + 会话流里程碑卡片 + 检查面板详情”**的三位一体呈现体系：

```text
┌─────────────────────────────────────────────────────────────────┐
│ 主对话转录区 (Transcript)                                        │
│  - 消息流中遇到 update_plan 时渲染：                               │
│    [ 📋 计划更新 · 第 2/5 步进行中 (已完成 1 项) ] (可展开详情)       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 输入舱上方常驻条 (Pinned Plan Dock)                                │
│  - 紧贴 Composer 顶部，不随对话滚动                                │
│  - [✓ 1/5]  ● 正在执行: 修改 DiffViewer 支持双栏对比     [展开 ▾]    │
│  - (展开后) 柔和浮层显示完整步骤清单与勾选态                          │
├─────────────────────────────────────────────────────────────────┤
│ 一体化输入舱 (Composer)                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 核心设计原则
1. **零内容不占位**：当会话无计划（`snapshot.plan == null`）时，**完全不渲染**任何常驻 DOM 节点，杜绝空白间隙或布局位移（Zero CLS）。
2. **一眼扫尽（Glanceable）**：常驻条高度紧凑（32px~36px），单行显示：`整体进度微标 (如 2/5)` + `当前状态指示` + `进行中步骤标题` + `展开折叠按钮`。
3. **呼吸感与克制动效**：
   - 进行中状态（`in_progress`）：采用鼠尾草绿（`--accent-sage: #55684d`），左侧状态圆点带有 2.4s 的柔和呼吸微光；
   - 遵守 `prefers-reduced-motion`，在系统开启减弱动态效果时回落为静态高亮；
   - 完成状态（`completed`）：柔和成功绿（`--success: #226d40`）配轻量勾选符（`✓`）；
   - 待办状态（`pending`）：中性灰色空心圆圈（`○`）。
4. **有界与防遮挡**：
   - 步骤总数最多可达 100 项（`schemas.ts`），展开面板必须设最大高度（`max-height: 260px`），内部自主滚动，**严禁挤占或遮挡主输入框**。

---

## 3. 详细功能与组件规格

### 3.1 组件结构划分
在 `src/renderer/components/workbench/plan/` 目录下新建专用模块：

```text
src/renderer/components/workbench/plan/
├── PlanDock.tsx         # 悬停在 Composer 上方的常驻条与折叠面板
├── PlanMilestone.tsx    # Transcript 中渲染 update_plan 产生的消息级卡片
├── PlanProgressBar.tsx  # 步骤分段进度条（分节细线或百分比条）
├── PlanStepList.tsx     # 可复用的步骤清单（带序号、状态微标、截断控制）
├── useActivePlan.ts     # 计划派生状态与计算 Hook
└── plan.css             # 统一计划样式表
```

---

### 3.2 模块实现规格

#### A. 状态衍生 Hook (`useActivePlan.ts`)
从 `state.activeSnapshot.plan` 派生结构化只读数据，提供高效选择器：

```typescript
export interface ActivePlanSummary {
  readonly hasPlan: boolean;
  readonly totalSteps: number;
  readonly completedSteps: number;
  readonly progressPercent: number; // 0 - 100
  readonly currentStep: {
    readonly index: number; // 1-based
    readonly title: string;
    readonly status: "in_progress" | "pending" | "completed";
  } | null;
  readonly explanation: string;
  readonly steps: readonly TaskPlanStep[];
}

export function useActivePlan(): ActivePlanSummary | null;
```

**计算逻辑**：
- `completedSteps`：`steps.filter(s => s.status === "completed").length`。
- `currentStep`：优先取第一个 `status === "in_progress"` 的步骤；若无进行中步骤（例如刚完成一步正在过渡），则取第一个 `status === "pending"`；全部完成时取最后一步。

---

#### B. 输入舱常驻条 (`PlanDock.tsx`)
- **挂载位置**：位于 `src/renderer/components/workbench/Composer.tsx`（或拆分后的输入容器）正上方，处于 `.workbench-main` 底部锚定流内。
- **收起状态（默认单行条）**：
  - 容器尺寸：高度 `36px`，两端圆角与 Composer 协调（`8px` 或 `12px`）。
  - 背景与边框：`background: var(--surface-soft)`，上边框或微弱全边框 `1px solid var(--border-subtle)`。
  - 左侧：分段进度指示 `[2/5]` 或柔和绿色胶囊徽标。
  - 中间：当前步骤文字（自动文本截断 `text-overflow: ellipsis`，鼠标 hover 展示原生 `title`）。
  - 右侧：展开/收起切换按钮（附带快捷折叠键，如鼠标点击或 `Alt+P`）。
- **展开状态（清单浮层）**：
  - 向上平滑展开或弹出轻量 Popover，呈现完整的 `1..N` 步骤。
  - 每一项展示状态图标（`✓` / `●` / `○`）、步骤描述，以及 `explanation`（支持简要 Markdown 展开）。

---

#### C. 转录区里程碑卡片 (`PlanMilestone.tsx`)
- **挂载位置**：在 `src/renderer/components/workbench/Transcript.tsx` 中识别 `item.call.function.name === "update_plan"`。
- **替代行为**：不使用默认的 `ToolDisclosure`，替换为专用的 `PlanMilestone`。
- **展示内容**：
  - 标题栏：`📋 执行计划已更新` + 变更说明 `explanation`；
  - 紧凑网格/列表展示本次更新后的所有步骤，当前步骤高亮显示；
  - 提供与之前版本对比的微标（如“第 3 步标记为已完成”）。

---

#### D. Inspector 联动维护
- `src/renderer/components/workbench/RuntimePanels.tsx` 中的“计划”小节继续保留，直接复用 `PlanStepList` 组件，避免代码重复。

---

## 4. 样式与 CSS 变量契约 (`plan.css`)

严格复用现有 Design Tokens，无需新增全局色值：

```css
/* 容器常驻条 */
.wb-plan-dock {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-3);
  margin-bottom: var(--space-2);
  background: var(--surface-soft);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--text-secondary);
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

/* 呼吸动画：进行中步骤微标 */
.wb-plan-dot-active {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--accent-sage);
  box-shadow: 0 0 0 0 rgba(85, 104, 77, 0.4);
  animation: wb-plan-pulse 2.4s infinite cubic-bezier(0.4, 0, 0.6, 1);
}

@keyframes wb-plan-pulse {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(85, 104, 77, 0.4); }
  70% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(85, 104, 77, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(85, 104, 77, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .wb-plan-dot-active {
    animation: none;
  }
}
```

---

## 5. 关键边界与防御性规则

1. **会话切换隔离**：
   - 切换到不同会话（`selectSession`）或点击“新建会话”时，`PlanDock` 必须瞬间重置，不得闪烁显示上一会话的残留计划。
2. **非法/不规范 Plan 容错**：
   - 即使后端因异常返回了缺少 `steps` 的畸变数据，前端通过 Zod safeParse 或降级保护，只记录控制台警告，不得导致渲染进程白屏崩塌。
3. **窄屏移动端适配**：
   - 屏幕宽度 `< 640px` 时，常驻条简化为：`[2/5] 正在执行... (点击查看)`，隐藏长文字描述，避免撑破视口横向滚动。

---

## 6. 测试与验收标准

实施完成后必须通过以下检验：

1. **单元测试（新增 `tests/renderer/plan-dock.test.ts`）**：
   - `snapshot.plan` 为 `undefined` 时，`PlanDock` 渲染为空（`null`）；
   - 5 步计划中 2 步 `completed`、1 步 `in_progress` 时，正确渲染进度比 `2/5` 及当前步文字；
   - 点击展开/收起按钮，正确定位 ARIA 属性（`aria-expanded`）。
2. **回归测试**：
   - 运行 `pnpm vitest run tests/renderer/` 确保所有既有 36+ 渲染测试 100% 通过。
3. **无障碍检查**：
   - `PlanDock` 具有清晰的 `role="region"` 与 `aria-label="当前任务计划进度"`；
   - 展开按钮能通过键盘 `Tab` 聚焦，并由 `Enter` 或 `Space` 触发展开。

---

## 7. 快速模型实施 Prompt 范例

后续指派模型实施时，可直接发送以下 Prompt：

```markdown
请根据 docs/FRONTEND_PLAN_REQUIREMENTS.md 的完整规格实现前端 Plan 展示功能：
1. 在 src/renderer/components/workbench/plan/ 目录下新建 useActivePlan.ts、PlanDock.tsx、PlanStepList.tsx 与 plan.css；
2. 将 PlanDock 引入至 Composer.tsx 输入框正上方，在有计划时常驻显示当前步骤与整体进度，无计划时不占位；
3. 严格遵循 DESIGN.md 的 CSS 变量与极简风格，支持展开查看完整步骤；
4. 编写 tests/renderer/plan-dock.test.ts 验证无计划、进行中及全部完成的渲染状态；
5. 运行 pnpm vitest run tests/renderer/ 确保所有测试通过。
```
