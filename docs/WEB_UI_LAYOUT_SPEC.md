# Forge Web UI 布局优化规格契约 (Web UI Layout Spec)

> 本文档规范 Forge 桌面与 Web 工作台（`src/renderer/**`）的布局重构与自适应体系，解决三栏挤压、断点跳跃、输入舱跳跃（Layout Shift）及 CSS 冗余覆盖问题，严格对标 [DESIGN.md](../DESIGN.md) 契约。

---

## 1. 目标与设计原则

1. **统一容器架构，消除冗余骨架**：
   - 梳理并废弃 `src/renderer/components/layout/` 中未投入生产的旧骨架（`PanelSplit.tsx`、`Shell.tsx`、`layout.css`），或将其重构为受控的核心布局组件，统一全站唯一的页面外壳标准。
2. **中等视口（1024px ~ 1440px）自适应与呼吸感**：
   - 当前主流 13~15 寸笔记本（1280px ~ 1440px）在展开右侧 Inspector（380px）时，中央主阅读区严重受挤压。
   - 优化自适应弹性，在中等屏幕下 Inspector 支持 Overlay 浮层抽屉模式或弹性窄化（如 320px），保证中央任务流始终保有 ≥ 700px 的舒适阅读宽度。
3. **消除新任务（Welcome）到执行流（Transcript）的位置跳跃（Layout Shift）**：
   - 统一外层滚动归属，避免 `workbench-main` 与 `workbench-conversation-scroll` 之间的滚动条闪烁与容器转移。
   - 平滑 Composer 在欢迎态（居中）与执行态（吸底）之间的过渡。
4. **Header 空间治理与信息分层**：
   - 解决 Header 中会话标题被 CommandPalette 与多重操作按钮挤压的问题。
   - 拆分全局控制项（搜索、设置）与会话上下文操作（重命名、删除、导出）。
5. **规范响应式断点阶梯**：
   - `> 1440px`：宽屏全功能展开（侧栏 264px + 主阅读流 780px 居中 + 检查区 380px）。
   - `1024px ~ 1440px`：桌面自适应（侧栏 232px 紧凑，展开检查区时不挤压主视窗）。
   - `768px ~ 1024px`：平板/中视口模式（侧栏可收拢为 Icon Rail，检查区抽屉化）。
   - `< 768px`：紧凑移动端模式（顶通 Tab 导航：会话 / 任务 / 详情 / 设置）。

---

## 2. 详细执行任务清单

### 任务 1：废弃旧版无效布局组件与清理 CSS 冲突
- **文件**：
  - `src/renderer/components/layout/Shell.tsx`
  - `src/renderer/components/layout/PanelSplit.tsx`
  - `src/renderer/components/layout/layout.css`
  - `src/renderer/showcase/PrimitiveShowcase.tsx`
  - `src/renderer/default/BootstrapScreen.tsx`
- **要求**：
  - 将 `PrimitiveShowcase` 和 `BootstrapScreen` 对 `Shell`/`PanelSplit` 的依赖改造成直接使用统一的工作台或轻量结构，消除项目中孤立并与生产环境冲突的旧 layout 体系。
  - 清理 `app.css` 中由于重复声明而被迫使用的 `!important`，规范 `.workbench-main` 与 `.wb-app` 的盒模型。

### 任务 2：主界面三栏网格弹性度量（Grid / Flex Refactor）
- **文件**：
  - `src/renderer/components/workbench/app.css`
  - `src/renderer/styles/tokens.css`
  - `src/renderer/styles/workspace-theme.css`
  - `src/renderer/components/workbench/App.tsx`
- **要求**：
  - 在 `tokens.css` 中引入自适应尺寸变量：
    ```css
    --rail-width-compact: 232px;
    --inspector-width-compact: 320px;
    ```
  - 当屏幕处于 `1024px ~ 1366px` 且 Inspector 展开时，Inspector 采用 `var(--inspector-width-compact)`，并确保中间 `.conversation-inner` 不会被压缩到小于 `640px`。
  - 侧边栏与检查器收起动画平滑，关闭时严格置 `pointer-events: none` 与 `visibility: hidden`。

### 任务 3：Header 布局重构与标题保护
- **文件**：
  - `src/renderer/components/workbench/App.tsx`
  - `src/renderer/components/workbench/app.css`
- **要求**：
  - 将 Header 划分为三大网格/弹性区：
    1. **Start**：`CommandPalette` 紧凑搜索入口；
    2. **Center**：会话标题（居中对齐或自然延伸，带 Tooltip，最小宽度保障，平滑省略）；
    3. **End**：待审批气泡（若有）、详情切换开关、会话操作组（`SessionActions`）、设置按钮。
  - 当宽度受限（≤ 900px）时，`SessionActions` 折叠收敛，确保标题至少保留 160px 可视宽度。

### 任务 4：统一页面滚动归属与平滑欢迎态
- **文件**：
  - `src/renderer/components/workbench/Welcome.tsx`
  - `src/renderer/components/workbench/Transcript.tsx`
  - `src/renderer/components/workbench/new-session.css`
  - `src/renderer/components/workbench/app.css`
- **要求**：
  - 新建任务 Welcome 页与 Transcript 统一置于同一个主阅读流滚动区域，或者使两者使用同构的父级视口边界。
  - 杜绝 `@media (max-height: 700px)` 时外层与内层双重滚动的问题。

---

## 3. 验收与质量门禁

1. **测试用例全绿**：`pnpm test` 必须通过，包含 `inspector-layout-mounted.test.ts`、`new-session-mounted.test.ts` 等。
2. **样式无回归**：
   - 亮暗双色主题无对比度破坏；
   - 移动端（390px）、平板（768px/1024px）、笔记本（1440px）、宽屏（1920px）各视口无水平横向溢出滚动条。
3. **编译检查**：运行 `node scripts/build-core.mjs` 确保构建成功。
