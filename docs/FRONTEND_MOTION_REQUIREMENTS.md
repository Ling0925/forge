# Forge 前端动效体验优化需求与技术规格

> 本文档针对 Forge 桌面与 Web 渲染端（`src/renderer/**`）的交互动效进行系统性诊断，对标现代顶级工作台（Linear、Raycast、Cursor、Claude Desktop）的物理交互与动效标杆，制定轻量、丝滑且完全不牺牲渲染性能的动效设计与实现规格。
>
> - 核心文件：`src/renderer/styles/motion.css`、`src/renderer/components/workbench/app.css`、`src/renderer/styles/tokens.css`
> - 设计契约：遵守 [DESIGN.md](../DESIGN.md) 温暖极简美学，严守 `prefers-reduced-motion` 无障碍降级规范。

---

## 1. 现状诊断：为什么当前显得“生硬、不够顺畅”？

经过对代码库与实际运行渲染的排查，主要瓶颈在于**关键状态变更时缺乏物理连续性过渡**：

1. **面板展开/收起的瞬态硬断（Hard Layout Snap）**：
   - 桌面端收起 Inspector 抽屉时，直接应用了 `display: none`（`app.css:1146`），导致 CSS 退出动画被浏览器直接略过；主对话区域从原宽瞬间拉伸跳变，视觉冲击生硬。
2. **折叠展开高度突变（Accordion Height Jitter）**：
   - 思考过程（`Reasoning`）与工具卡片（`ToolDisclosure`）基于原生 `<details>`，展开时内容瞬间撑开数百像素，下方所有消息和滚条产生强烈垂直抖动。
3. **模型生成缺乏灵动质感（Streaming Stiff）**：
   - 流式 Token 生成时仅每 80ms 刷新纯文本，末尾**缺少呼吸打字光标（Blinking Caret）**；
   - 思考中状态仅有静态文字，缺乏体现“AI 正在高速运转”的细腻流光（Shimmer）。
4. **选项卡（Tabs）缺乏滑动手感**：
   - Inspector 四个 Tab（运行时/检查点/资源/MCP）切换时只是瞬变背景色，缺乏现代 App 标志性的“滑动胶囊指示器（Sliding Pill）”。
5. **滚动回底瞬间硬跳**：
   - 点击“查看最新消息”时，调用硬编码的 `scroll.scrollTop = scroll.scrollHeight`，造成瞬间断裂感，丢失了视口滑动的空间连续性。
6. **操作缺乏物理微反馈（Micro-interactions）**：
   - 复制按钮点击后仅静态换图标，审批卡片点击“批准”后硬性消失，缺乏自然滑出的完成感。

---

## 2. 动效设计哲学与核心性能原则

- **物理惯性（Spring & Ease-out）**：遵循自然物理世界的阻尼与回弹，入场采用轻快减速（`cubic-bezier(0.16, 1, 0.3, 1)`），退场轻柔收起。
- **纯 GPU 合成驱动（Composite-Only Performance）**：绝不通过 JS 定时器逐像素计算 `height`，主要过渡属性严格限制在 `transform`、`opacity` 与 CSS 现代特性的无损插值，维持 60~120 FPS 丝滑帧率。
- **克制而不喧宾夺主**：动效服务于“信息层级引导”与“心理等待缓冲”，杜绝夸张浮夸的翻转，最长单次动效不超过 220ms。
- **100% 遵守减少动态效果（Accessibility First）**：在检测到 `prefers-reduced-motion: reduce` 时，瞬间归零所有时长，保证敏感用户无眩晕。

---

## 3. 六大核心动效改造方案

### 动效 1：抽屉与工作区分栏的弹性平滑过渡（Smooth Shell Transition）

#### 现状与痛点
`Inspector` 折叠时使用 `display: none`，宽度瞬间从 380px 变为 0，主界面右侧产生瞬断白块。

#### 技术规格
- 移除硬编码的 `display: none`，采用 `width` + `transform` + `opacity` 复合补间：
- 桌面端 Inspector 容器：
  ```css
  .wb-app .workbench-inspector {
    width: var(--inspector-width, 380px);
    transition: 
      width var(--motion-duration-md) var(--motion-ease-out),
      opacity var(--motion-duration-sm) ease,
      transform var(--motion-duration-md) var(--motion-ease-out);
    overflow: hidden;
    will-change: width, transform;
  }
  
  .wb-app.inspector-collapsed .workbench-inspector {
    width: 0;
    opacity: 0;
    transform: translateX(16px);
    pointer-events: none;
    border-left-color: transparent;
  }
  ```

---

### 动效 2：零 JS 纯 CSS 平滑高度展开（Smooth Accordion Expansion）

#### 现状与痛点
`ToolDisclosure`、`Reasoning` 与 `DiffViewer` 展开时，文字与代码块瞬间撑开，视觉跳跃剧烈。

#### 技术规格
利用现代 CSS 伪类与网格行插值 `grid-template-rows: 0fr -> 1fr` 技巧，无需任何 JS DOM 测量即可实现完美的 0 到自适应内容高度过渡：

```css
/* 纯 CSS 平滑展开折叠包裹器 */
.wb-accordion-content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.wb-accordion-content.is-open,
details[open] > .wb-accordion-inner-wrapper {
  grid-template-rows: 1fr;
}

.wb-accordion-inner {
  overflow: hidden;
  min-height: 0;
}
```

- **实施落点**：
  1. `Reasoning.tsx`：思考过程展开与收起；
  2. `ToolDisclosure.tsx`：工具详情与输出展开；
  3. `DiffViewer.tsx`：代码变更从预览行（10 行）展开至完整补丁。

---

### 动效 3：流式打字呼吸光标与思考流光（Streaming Caret & Thinking Shimmer）

#### 现状与痛点
AI 生成时文字硬生生逐块冒出，缺少呼吸打字焦点。

#### 技术规格
1. **流式打字光标（Streaming Caret）**：
   在 `.message-streaming .message-body` 的最后追加伪元素或专用光标组件：
   ```css
   .wb-streaming-caret {
     display: inline-block;
     width: 6px;
     height: 1.15em;
     margin-left: 3px;
     vertical-align: -0.15em;
     border-radius: 2px;
     background: var(--accent-sage);
     animation: wb-caret-blink 1s cubic-bezier(0.2, 0, 0, 1) infinite;
   }

   @keyframes wb-caret-blink {
     0%, 100% { opacity: 1; }
     50% { opacity: 0; }
   }
   ```
2. **思考过程微光流动（Thinking Shimmer Header）**：
   当 `Reasoning` 处于 `live={true}`（模型正在思考）时，标题栏文字带有极其轻柔的低饱和微光扫过：
   ```css
   .reasoning-live-header {
     background: linear-gradient(
       90deg,
       var(--text-muted) 0%,
       var(--text-primary) 50%,
       var(--text-muted) 100%
     );
     background-size: 200% 100%;
     -webkit-background-clip: text;
     -webkit-text-fill-color: transparent;
     animation: thinking-shimmer 2.2s linear infinite;
   }

   @keyframes thinking-shimmer {
     0% { background-position: 200% 0; }
     100% { background-position: -200% 0; }
   }
   ```

---

### 动效 4：选项卡滑动胶囊指示器（Sliding Tab Indicator）

#### 现状与痛点
Inspector 顶部 Tab 切换时是单项各自开关背景，缺乏连贯指示。

#### 技术规格
- 为 `src/renderer/components/primitives/Tabs.tsx` 引入轻量指示器（Indicator）：
- 当选中的 Tab 改变时，指示器药丸（Pill）利用 CSS 变量 `--indicator-left` 与 `--indicator-width`，通过 `transform: translateX(...)` 平滑滑动定位：
  ```css
  .tabs-indicator {
    position: absolute;
    height: calc(100% - 6px);
    top: 3px;
    border-radius: var(--radius-sm);
    background: var(--surface-card);
    box-shadow: var(--shadow-sm);
    transition: 
      transform var(--motion-duration-sm) var(--motion-ease-out),
      width var(--motion-duration-sm) var(--motion-ease-out);
    pointer-events: none;
    z-index: 1;
  }
  ```

---

### 动效 5：平滑回到底部（Smooth Catch-up Scroll）

#### 现状与痛点
当用户向上翻看历史，然后点击悬浮的“查看最新消息”按钮时，视口硬跳到底部。

#### 技术规格
- 修改 `Transcript.tsx` 中的 `jumpToLatest`：
  ```typescript
  const jumpToLatest = () => {
    navigation.current.reset();
    setHasNewContent(false);
    const scroll = scrollRef.current;
    if (scroll) {
      // 区分用户主动点击行为：采用平滑缓动滚动
      scroll.scrollTo({
        top: scroll.scrollHeight,
        behavior: "smooth",
      });
    }
  };
  ```
- 保留原有原则：模型打字流（Token Streaming）高频触发时，**严禁使用 smooth 滚动**，继续保持原生硬赋值以防止滚动追随滞后。仅对**用户主动交互（点击按钮）**开启 smooth。

---

### 动效 6：操作成功的微反馈动效（Micro-Feedbacks）

1. **代码复制成功弹出微反馈（Copy Feedback）**：
   - 点击代码块或 Diff 的复制按钮时，图标不仅切换为对号，并施加轻快的回弹跳跃：
   ```css
   .copy-success-bounce {
     animation: copy-bounce 260ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
   }
   @keyframes copy-bounce {
     0% { transform: scale(0.8); }
     50% { transform: scale(1.15); }
     100% { transform: scale(1); }
   }
   ```
2. **审批完成优雅滑出（InlineApproval Slide-out）**：
   - 当用户点击“批准”或“拒绝”后，审批卡片高度收缩并向右淡出 120ms 后卸载，而非瞬间在 DOM 中生硬凭空消失。

---

## 4. 样式令牌扩展规范（`tokens.css`）

在 `src/renderer/styles/tokens.css` 或 `motion.css` 补充弹簧缓动曲率：

```css
:root {
  /* 弹性与微动效专用贝塞尔曲线 */
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.15);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out-smooth: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 5. 分步实施排期与测试矩阵

| 阶段 | 改造任务 | 影响范围 | 验收标准 |
| :--- | :--- | :--- | :--- |
| **Phase 0** | 1. 改造 Inspector 展开收起为平滑过渡（去 `display:none`）<br>2. 优化 `jumpToLatest` 按钮平滑滚动 | `app.css`<br>`Transcript.tsx`<br>`motion.css` | - 点击 Inspector 切换按钮，中央内容区域平滑过渡无跳断<br>- 点击“查看最新”平滑滑到底部 |
| **Phase 1** | 1. 流式文本增加呼吸光标（Caret）<br>2. 思考中状态增加轻量流光（Shimmer）<br>3. 复制按钮回弹动画 | `StreamingMarkdown.tsx`<br>`Reasoning.tsx`<br>`CodeBlock.tsx` | - 流式输出末尾有跳动光标，流结束后平滑淡出<br>- 思考进行中标题有微光流动 |
| **Phase 2** | 1. `ToolDisclosure` / `Reasoning` 采用纯 CSS 平滑折叠<br>2. Tabs 滑动胶囊指示器 | `ToolDisclosure.tsx`<br>`Tabs.tsx`<br>`motion.css` | - 点击折叠/展开工具，内容平滑展开，无垂直瞬间跳变<br>- Tabs 切换时药丸指示器丝滑滑动跟随 |

---

## 6. 快速模型实施 Prompt 范例

后续指派模型实施具体动效时，可直接发送：

```markdown
请按照 docs/FRONTEND_MOTION_REQUIREMENTS.md 的 Phase 0 规范进行动效优化：
1. 修复 Inspector 折叠与展开的生硬跳跃：在 src/renderer/components/workbench/app.css 和 motion.css 中，将原本桌面端的 display: none 改造为基于 width + transform + opacity 的平滑过渡；
2. 在 src/renderer/components/workbench/Transcript.tsx 中，让用户点击 jumpToLatest（查看最新消息）时使用 behavior: "smooth" 平滑滚动；
3. 保持 prefers-reduced-motion: reduce 时的完整降级（无动画）；
4. 运行 pnpm vitest run tests/renderer/ 确认既有测试全部通过。
```
