# Forge 设计契约

本文约束 Forge 桌面工作台、CLI 状态语义与界面实现，是视觉与交互工程的最高契约。Forge 是原创、中文优先的编码与本地任务代理工具，不复制、改造或依赖既有代理运行时。Electron + React + TypeScript 桌面与 CLI 使用同一原创核心、会话存储、模型提供方和工具；未经真实执行验证，不得展示成功。

## 0 设计研究来源与视觉演进

本契约由用户直接指示的视觉重构升级：彻底废弃早期冷调近黑控制台与默认组件堆叠样式（大量冗余边框、重叠卡片、机械网格），转向 **温暖浅色优先、精致极简的专业工作台（Warm Light-First Minimal Workbench）** 语法。

| 参考 | 来源 | 实际状态与决策 |
| --- | --- | --- |
| MiMo 桌面客户端参考截图 | 用户提供的参考图片（1973x1280，未经本项目验证的截图）与 https://mimo.xiaomimimo.com/desktop/ 营销页计算样式提取物 | **主美学语法参考**：借鉴温暖米白主画布、浅暖灰侧栏、石墨/橄榄色文字、克制鼠尾草绿点缀、圆润连续表面与开阔呼吸感。仅提取界面语法与视觉层级，绝不复制品牌资产、文案或 Moon 元素。 |
| Raycast | https://www.raycast.com/ | 紧凑命令入口（Cmd/Ctrl+K）、纯正键盘路径与上下文操作组织。 |
| Sunsama | 任务与设置材料 | 安静分组字段行、上下文帮助、中性悬停与无框行内属性选择。 |
| scroll-body-shell | 视口外壳模式 | 视口外壳固定，正文拥有唯一直属纵向滚动，杜绝双重纵向滚动条。 |
| supporting-pane | 辅助支持面板模式 | 宽屏按需展开检查抽屉/右面板，窄屏通过 Tab 切换；主任务区保持绝对主导。 |

视觉探索基于真实原语与实际会话状态构建；严禁在产品中植入伪造的展示数据、虚构阶段或营销 Hero 横幅。

## 1 空间氛围与视觉语素 (Atmosphere & Grammar)

Forge 展现的是沉稳、专注、温暖且精密的高级工作台氛围，消除“UI 控件拼接感”与“重叠边框牢笼”：

1. **Light-First 温暖质感**：明亮主题为默认核心体验，以温暖米白为底，辅以微妙暖灰侧栏与极度克制的鼠尾草绿。深色模式为暖炭黑与深橄榄调，信息层级完全对齐，杜绝冷蓝网格。
2. **去边框化与自然层级**：彻底淘汰卡片套卡片与全外框。主对话区域无外框、无背景堆砌，AI 回复自然融入画布；只有关键的主视图分界与必要的逻辑分组保留 1px 微弱细线。
3. **主对话为中心**：对话区域拥有开阔呼吸感（消息间距 28–36px，阅读行长 ~760px）。用户气泡为圆角 18px 的柔和温灰浅底，紧凑得体；助手消息为无边框富文本排版。
4. **横向静默工具行 (Quiet Tool Rows)**：工具调用与证据行默认折叠为水平静默单行条，包含柔和图标、工具名、目标与执行状态；点击平滑展开完整参数、退出码与原样输出，保持上下文干净。
5. **一体化圆润输入舱 (Integrated Composer)**：输入区由原本分散的多重字段与厚重大边框整合成一块一体化圆润（20–24px 圆角）悬浮白净表面；文字输入位于上方，工作区与权限策略静置于左下，模型标签与圆形运行按钮位于右下，无任何内部嵌套边框。
6. **精致有机的侧栏 (Calm Warm Sidebar)**：侧栏呈浅暖灰底，任务列表为单行任务名搭配精微状态微标（status dot）与圆润选中底色，去除非必要的冗余 badge 轰炸与杂乱边框。
7. **按需展开的右侧检查面板**：宽屏下检查面板可一键收起/展开，默认收起以提供最纯粹的专注对话环境；待审批与关键阻塞状态全局可见，绝不因收起而遗漏。

## 2 色彩语义系统 (Color Table)

模型与思考等级共用一个触发器和面板。模型名称可省略，末尾固定保留五格等高竖条（3px 宽、2px 间距、统一高度 11px），以 accent-sage 点亮极低至极高的 1–5 格；自动与关闭不填格并标注“自/关”。完整等级文字通过可访问名称与面板七项按钮提供，保存期间禁用等级操作；桌面与手机采用相同语义。

上下文底栏沿用 CLI 的四分类色系：指令蓝（light #005faf / dark #5fafff）、记忆紫（#870087 / #d787ff）、对话绿（#005f5f / #87d7af）、工具橙（#875f00 / #ffaf5f）。工具栏下方使用 3px 分段线，空余窗口保留底色；右侧以 11px 等宽数字显示最近缓存率和已用/总窗口。分类数值与文字图例放在点击展开的详情中，颜色不作为唯一信息。未知窗口不绘制占用比例，只展示已用量；窄屏仍保留右侧统计，线条弹性缩短。无动画，支持键盘打开、Escape 关闭。

以下为目标色彩，不是已通过的验收声明。实现必须验证正文 ≥ 4.5:1、必要图标与焦点 ≥ 3:1；装饰分隔线不承担唯一控件边界。

| Token | Light (首选暖白) | Dark (沉稳暖炭) | 语义与用途 |
| --- | --- | --- | --- |
| `--canvas-bg` | `#fdfdfb` | `#161915` | 主对话/正文画布背景 |
| `--sidebar-bg` | `#f6f6f2` | `#1c201b` | 侧边栏与固定外壳背景 |
| `--surface-elevated` | `#ffffff` | `#232822` | 输入舱、模态弹窗、浮层卡片 |
| `--surface-soft` | `#f1f2eb` | `#20251f` | 用户消息气泡、工具单行底色、次级容器 |
| `--surface-selected` | `#e9ede3` | `#2d352b` | 侧栏激活项、Tab 激活、高亮项底色 |
| `--surface-hover` | `#eef0ea` | `#282e26` | 交互悬停反馈底色 |
| `--surface-active` | `#e2e6dc` | `#333b31` | 点击/激活反馈底色 |
| `--text-primary` | `#242a22` | `#f1f3ed` | 主要文字、标题、高对比度正文 (对比度 > 14:1) |
| `--text-secondary` | `#5c6357` | `#a4aca0` | 副标题、时间戳、元数据、工具说明 (对比度 > 4.8:1) |
| `--text-muted` | `#697064` | `#a4aca0` | 次级占位符、微小辅助说明 |
| `--text-disabled` | `#697064` | `#a4aca0` | 禁用文字 (保留可辨度) |
| `--border-subtle` | `#e4e6de` | `#2f362d` | 大区主分隔线、极弱分组边线 |
| `--border-control` | `#a0a897` | `#74816d` | 输入框轮廓、控件微弱边界 |
| `--accent-sage` | `#55684d` | `#8fad82` | 品牌标志鼠尾草色、选中强调、微指示点 |
| `--accent-sage-soft` | `#eaf0e6` | `#253121` | 鼠尾草色软底色 |
| `--run-bg` | `#242a22` | `#f1f3ed` | 主运行按钮背景（高对比中性黑/白） |
| `--run-ink` | `#ffffff` | `#161915` | 主运行按钮文字/图标 |
| `--run-hover` | `#384035` | `#dbe0d7` | 主运行按钮悬停 |
| `--run-active` | `#1a1f18` | `#c7ccc3` | 主运行按钮按下 |
| `--success` | `#226d40` | `#7ed99e` | 已验证真实完成文字/图标 |
| `--success-bg` | `#edf7ef` | `#152c1e` | 成功微底色 |
| `--success-border` | `#aee4be` | `#295638` | 成功状态弱边线 |
| `--warning` | `#975a06` | `#f0be65` | 待审批、告警、需用户决策 |
| `--warning-bg` | `#fef7e9` | `#332510` | 告警微底色 |
| `--warning-border` | `#fedf89` | `#5e451b` | 告警状态弱边线 |
| `--error` | `#b82420` | `#ff8f85` | 失败、中断、危险操作 |
| `--error-bg` | `#fef3f2` | `#351a18` | 错误微底色 |
| `--error-border` | `#fecdca` | `#5e2b27` | 错误弱边线 |
| `--focus-ring` | `#55684d` | `#8fad82` | 统一 2px 键盘焦点外环 |
| `--shadow-sm` | `0 1px 3px rgba(36,42,34,0.05)` | `0 1px 3px rgba(0,0,0,0.25)` | 细微悬浮阴影 |
| `--shadow-composer`| `0 4px 20px rgba(36,42,34,0.06)` | `0 4px 24px rgba(0,0,0,0.4)` | 输入舱柔和阴影 |
| `--shadow-overlay` | `0 12px 36px rgba(36,42,34,0.12)` | `0 12px 40px rgba(0,0,0,0.6)` | 模态与浮层阴影 |

## 3 排版与字形节奏 (Typography & Hierarchy)

- **字体栈**：
  - Sans：`"Geist Variable", "Geist", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif`
  - Mono：`"Geist Mono Variable", "Geist Mono", "SFMono-Regular", "Cascadia Mono", "PingFang SC", "Microsoft YaHei", monospace`
- **字号与行高层级**：
  - 任务与窗口标题：`18px` / `26px`，`font-weight: 600`，字间距 `-0.01em`
  - 内容大标题：`20px - 22px` / `28px`，`font-weight: 600`
  - 桌面正文/助手 Markdown：`16px` / `1.8` (`28.8px`)，字间距 `0`，阅读舒适，开阔舒展
  - 窄屏正文 (Touch)：`17px` / `1.75` (`30px`)
  - 控件与普通文本：`14px` / `22px`，`font-weight: 450` 或 `500`
  - 紧凑元数据、工具条、微标：`12px` / `18px` 或 `13px` / `20px`
  - 代码与终端：`13px` / `20px`，等宽，保留原始缩进与换行
- **阅读行宽**：主对话正文宽度严格限制在 `max-width: 760px`（居中排布），保证中英文混排的最佳扫视体验。

## 4 布局尺度与滚动归属 (Layout & Scroll Contracts)

- **空间度量**：基于 4px 网格（4/8/12/16/20/24/32/40/48px）。
  - 应用顶部 Bar：高度 `56px - 64px`，简明标题、Cmd+K 搜索入口、检查器抽屉开关。
  - 左侧边栏：宽度 `256px`（可在 248–264px），浅暖灰独立色块。
  - 中央主内容区：左右内边距 `32px - 48px`（宽屏）/ `20px`（窄屏）。
  - 右侧检查面板：宽度 `360px`，可一键收拢，展开时不挤压主阅读流。
- **圆角体系**：
  - 控件与按钮：`8px`
  - 气泡与卡片：`14px - 18px`
  - 输入舱与模态：`20px - 24px`
  - Pill 微标与圆形按钮：`999px`（完全圆润）
- **滚动条归属原则 (Strict Scroll Architecture)**：
  - 全局视口严禁出现页面级外部滚动条。
  - 会话列表拥有独占纵向滚动条。
  - 对话记录流（Transcript）是主任务的唯一滚动主体，消息内不得有嵌套纵向滚动。
  - 检查面板是其自身的唯一纵向滚动容器。
  - 窄屏（≤768px）通过顶部导航在任务/检查间切换，抽屉式侧栏独立管理焦点，禁止背景穿透滚动。

## 5 核心原语重构规范 (Redesigned Primitives)

1. **Button (按钮)**：
   - 移除厚重描边与生硬内阴影。
   - `primary`：中性深色背景（浅色下为 `#242a22`，深色下为 `#f1f3ed`），纯白字，微圆角，轻盈悬停反馈。
   - `secondary` / `ghost`：无边框或仅有浅暖灰边框，靠背景微色（`--surface-hover`）表达交互。
   - `danger`：克制红底或幽灵红字，仅在真危险操作（如删除、强制中止）时显现。
   - 圆形 Icon Button：`36px` 触摸尺寸，桌面居中对齐，触控端保持 `44px` 命中。
2. **Composer (一体化输入舱)**：
   - 不再是带有大外框的多层表单，而是居中悬浮的单体圆润（`22px` 圆角）卡片。
   - 内置无边框自适应 Textarea（字号 15px，文字颜色深石墨色），底部集成精炼操作栏：
     - 左侧：微型药丸选择器（工作区路径、执行权限策略）。
     - 右侧：用量入口、模型短名选择器、思考等级菜单、30px 圆形发送按钮。思考等级沿用全局配置，默认由模型决定，保存成功后用于后续请求；保存期间阻止发送，失败保留旧值并提示。发送、停止和取消等待保持同一尺寸与中心，加载图标原位替换操作图标；沿用按钮旋转动画与减少动态效果偏好，不额外显示底部提交提示。
     - 用量浮层沿用用户提供的 Usage 参考图：单层圆角面板、左右对齐的指标、上下文细进度条，会话与 Tokens 分组；采用现有字体、间距与明暗主题变量，桌面宽 320px，窄屏宽度不超过视口减 32px。入口显示上下文比例圆环与 CH，点击/键盘展开，Escape 或外部点击关闭。上下文只使用最近一次上下文事件，估算必须标记；会话消耗累计已上报 usage，运行中加入未结算请求，结束后用汇总替换避免重复。未知窗口不显示伪百分比，未上报缓存与零命中区分，未知账号不显示、未知价格不估造费用。
   - 消除任何冗余内层多重边框。
3. **ToolDisclosure (水平静默工具条)**：
   - 默认折叠态呈现为极简单行条，轻量柔和底色（`--surface-soft`），左侧工具小图标与动作名称，右侧时间与状态微点。
   - 展开后展示代码格式的真实参数与工具输出，保留完整退出码与错误原因，无夸张边框。
4. **User Bubble (用户气泡)**：
   - 位于对话右侧偏向，柔和浅灰圆角泡（`18px` 圆角，右上略微收敛），底色为 `--surface-soft`，文字自然排布，宽度适中（不超过 75%）。
5. **Assistant Message (助手回复)**：
   - 位于左侧，与主画布完美融合，零外边框、零多余背景。
   - 标题、段落、列表、引用与代码块遵循现代出版级 Markdown 间距与行高规范。
6. **Inspector Tabs & Sections (检查面板)**：
   - 紧凑无底线 Tab，激活态以文字加粗或极简下沉指示线表示。
   - 信息呈现为成组的静默键值对，去除包裹式卡片边框。
7. **Modal & Dialogs (对话框与设置)**：
   - `24px` 充裕内边距，温润圆角（`20px`），柔和遮罩背景，结构干净清晰。

## 6 行为、安全与无障碍保障 (Behavioral & A11y Retained)

视觉风格的优雅蜕变绝不牺牲任何既有功能与安全契约：
- **无障碍门禁**：正文对比度持续保持 ≥ 4.5:1，交互热区触控端 ≥ 44px，全键盘可导向与可见 2px 焦点环。
- **动态控制**：完全尊重 `prefers-reduced-motion: reduce`，关闭位置位移与平滑滚动，保留必要瞬时透明度状态切换与明确忙碌文字提示。
- **安全与权限明确性**：`readonly`、`workspace`、`unrestricted` 权限语义与 Shell 显式确认逻辑完整保留，待审批条目始终全局突出显示。
- **真实证据原则**：文件修改、终端输出、差分比较真实可查，不伪造阶段，不把未验证结果标为成功。

### 保留的完整行为契约

- 原生窗口框架保留；会话切换不终止任务，关闭窗口行为以宿主真实行为为准。CLI 复用事件和权限语义，不依赖颜色表达状态。
- 模型精简标签必须保留完整 ID 可查、真实 catalog/datalist 和手动 ID 输入；不得虚构或静默替换模型。baseURL 与来源可查但凭据永不回显。API key 仅一次 masked 输入，提交宿主后清空。
- workspace 文件操作按核心范围政策，shell 逐次显式批准；用户选择 unrestricted 即表示授权，不再二次确认。UI 不声称 OS 沙箱，不绕过核心策略、不复用失效审批。
- 初始 Enter 发送，Shift+Enter 换行；草稿一旦出现真实换行（包括粘贴），Enter 改为换行且只能点击发送，删除换行不会恢复快捷发送。成功发送并清空该草稿后重置，失败及会话切换保留模式。Ctrl/Cmd+Enter 不发送；IME 组合时不提交。失败保留草稿，会话草稿隔离，异步操作以会话键/OperationScope 防止旧结果污染。
- 原语的默认、hover、active、focus、disabled、loading、empty、error 全部覆盖；disabled 保持可读，busy 保留文字和布局并防重复。未知状态不表示成功。
- Tabs 方向键/Home/End 移动焦点，Enter/Space 手动激活；隐藏内容保持挂载以保留未保存资源/设置输入。模态进入、圈定、恢复焦点，Escape 取消，危险动作不默认获得焦点。Cmd/Ctrl+K 聚焦搜索，跨模态导航先关闭 palette。
- transcript 距尾部超过64px 停止自动跟随，真实新内容提示查看最新；会话切换重置跟随，证据展开保持阅读位置，所有跳转即时。工具输出不可信，显示脱敏/截断事实、失败退出码及空输出；内部 reconciliation 明确内部且默认折叠。
- 审批始终在检查分类前或全局可见；命令不完整禁止批准，失效请求说明重试。文件、diff、终端、浏览器证据关联真实任务，建议与已应用差异区分。
- 独立 showcase 标注示例数据，覆盖亮暗、CJK/长路径、390/768/1024/1440/1920px、200%缩放、键盘、读屏、高对比、减少动态、空/离线/拒绝/失败/中断。截图不替代交互检查；无障碍债务没有默认豁免。
- 无渐变、玻璃、装饰 hero、营销资产或虚构阶段；截图是美学参考，营销页提取不等于已读取应用 CSS。此契约替代旧视觉方向，不降低严格 TypeScript、信任边界、真实运行测试及安全要求。

配色验证（Author A 局部检查）：light 主文/画布14.43:1、次文/soft5.52:1、sage/白6.05:1；dark 主文/画布15.86:1、次文/elevated6.43:1、sage/elevated6.06:1。此局部 token 验证不代表完成真实 DOM 全状态验收。

## 8 Claude Desktop-inspired workspace (2026-10-16)

This section supersedes earlier palette and home-layout decisions. The supplied
Claude Desktop screenshot is a spatial and aesthetic reference, not a pixel clone.
Forge retains its own name, controls, session data and permission semantics.

Active runs accept permission changes from the composer. The menu reflects the host-confirmed permission; unrestricted releases pending root approvals, while readonly rejects them. Existing processes are not interrupted. Plan mode and child permission ceilings still apply, and child approvals are not released by changing the parent run.

Transcript synchronization separates persisted message freshness from live event timestamps. Tool transitions and terminal events retain unsynchronized assistant output until saved messages acknowledge it; failed partial output remains visible in memory. Unpositioned historical errors appear in a collapsed group before the conversation, never appended behind the newest answer.

The composer reserves a 20px activity slot above the input to keep controls stationary across run transitions. Only the selected live run fills it. Three 3px by 12px bars use the existing accent ink and a staggered 1.2s scale/opacity rhythm; 12px text identifies execution, approval waiting or cancellation. Approval and cancellation stop the rhythm, terminal states clear the indicator, and reduced-motion uses static bars. No progress percentage or timer is invented. This uses native CSS with no animation dependency; the external loader reference was unreachable during implementation.

The execution inspector opens on Runtime, with Changes and Resources as separate tabs. Its header shows the selected session status; quiet sections use 12px text, 16px section spacing and aligned key/value rows. Tabs remain sticky within the single inspector scroll container. Plans and active child tasks are visible; raw context statistics, checkpoint management and long metadata use native disclosures. Long IDs and paths wrap without widening the pane. Diagnostics load only when their disclosure opens, not on streaming deltas. Existing approval actions stay above all categories, and touch targets retain 44px.

- Surfaces: warm paper light (`#faf9f6`, sidebar `#f2f1ed`) and charcoal dark
  (`#171716`, sidebar `#121211`, elevated `#222221`). Neutral borders, no blue cast.
- Ink: light primary `#292824`, secondary `#68665f`; dark primary `#eeede8`,
  secondary `#aaa79f`. Terracotta accent `#a54f35` / `#dc9477`, used sparingly.
- Desktop rail: 264px. Main reading/home measure: 880px. Home overview: 560px.
  Compact revision: rail 232px, header 44px, reading measure 760px, overview
  420px. Greeting: 22px / 1.4, weight 500. Main gutter: 32px, mobile: 16px.
  Desktop controls: 28px; small controls: 24px. Touch controls retain 44px.
  Overview is a flat two-column summary, not nested cards. Composer padding
  6px vertical / 10px horizontal, radius 12px, initial prompt height 36px;
  prompt height follows content and soft wrapping up to six computed line heights
  plus padding, then scrolls internally. Empty drafts return to 36px; width changes
  also recalculate height. The input alone owns the border/background;
  mode, permission, model and send controls live in a separate unbordered toolbar
  below it with a 4px gap. Status and approval messages remain below the toolbar.
  Sidebar sessions: 28px desktop rows, 44px coarse-pointer targets. No inline
  time/model metadata. Completed sessions have no status dot; pending approval
  takes precedence. Hover/focus opens a 280px viewport-bounded metadata tooltip
  with dates, status, full model ID and own-session reported run token totals.
  Fetch full snapshots only on sustained hover/focus; unknown/partial usage is
  explicitly labelled. Escape, focus exit and scroll dismiss the tooltip.
  Model catalog: 300px popover, 12px labels, 32px desktop rows; search never
  mutates selection until an item or explicit custom-ID action is activated.
  Full IDs wrap and remain inspectable. Escape restores trigger focus; outside
  pointer and focus exit dismiss. Empty/error/loading states stay visible.
  Settings: 560px dialog, 16px body inset, 12px group gaps; appearance and budget
  fields use two columns on desktop and one on phones. Advanced budget/browser
  fields remain mounted in a collapsed disclosure. Save/list operations disable
  edits and close until resolved, with visible busy feedback. Touch targets 44px.
  Mode/permission menus support arrow navigation, Home/End, Escape, Tab exit,
  pointer dismissal and focus restoration. Focus rings belong to the focused
  control; input focus uses one quiet container border, never nested rings.
- Home greeting sits near the top; a single quiet overview shows actual unarchived
  session and workspace counts. Unknown/loading values use an em dash. No invented
  token totals, heatmaps or activity. The composer sits near the bottom with open
  space between overview and prompt; short screens scroll the main region.
- Reuse existing sidebar, composer, buttons and model/permission menus. Home
  overview uses a semantic definition list. Composer radius 18px; neutral focus
  border plus visible keyboard focus ring. Sidebar controls use tonal surfaces.
- Mobile keeps the existing navigation and drawer. Overview reflows without
  truncating Chinese labels. All existing theme, modal and approval states remain.
- Accepted scope: reference-inspired layout, not Claude branding or exact copy;
  API inference and desktop packaging are outside this visual change's validation.

## 7 Gemini 最终视觉精修落地 (Gemini Visual Refinement Pass)

本轮由 Gemini 负责整套界面视觉最终微调与精致度打磨，严格遵守零功能/业务/测试代码修改原则，仅调整 CSS 与设计契约：

1. **主对话首用欢迎层级 (Deliberate First-Use Welcome State)**：
   - 彻底修正主区域首用欢迎区“泛化小图标+紧缩文字挤在顶部”的疏离空旷感，建立清晰呼吸感与比例节奏。
   - 采用 `clamp(40px, 14vh, 120px) auto auto auto` 纵向定位，在宽屏桌面与紧凑笔记本均落入舒适黄金视线区域。
   - 图标升级为 56×56px 柔和微底（`--surface-soft`）与 28px 鼠尾草色图标；标题提升至 22px / 30px、字重 600、微负字间距；正文行宽限定 440px、行高 1.65。
   - 新建动作采用 38px 全圆角（999px）柔和表面药丸按钮，静默亲和；样式严格限定于 `.wb-app .conversation-inner .empty-state`，绝不放大检查面板内部紧凑型辅助空状态。
2. **侧边栏结构与动作层级理顺 (Sidebar Brand & Action Hierarchy)**：
   - 侧栏顶部重塑为：品牌独立置顶（16px，字重 600）→ 通栏静默新建任务按钮（`min-height: 36px`，触控端 ≥44px）→ 工作区路径展示（横向弹性对齐，路径单行截断并可完整选取复制）→ 搜索与已归档筛选 → 会话列表。
   - 会话列表项右侧摘要展开按钮垂直平滑居中，展开时自动归位；会话状态圆点与标题间距对齐。
   - 清除历史重构在 `workbench.css` 与 `app.css` 中残留的重复和冲突覆盖，确立整洁规范的级联规则。
3. **窄屏端导航、弹窗与紧凑排版适配 (Mobile Ergonomics & CJK Clarity)**：
   - 窄屏顶部导航 `.wb-mobile-nav` 实现 44px 热区、等宽伸缩与明确的 `aria-pressed="true"` 选中底色，消除移动端操作迷失。
   - 原生对话框与设置在 ≤640px 视口下自适应外边距（16px）与内部滚动高度（`calc(100dvh - 160px)`），所有按钮与输入字段完整展现不裁切。
   - CJK 排版保持自然字距；工作区路径、代码块、命令、diff、错误详情与模型标识符全局设置 `user-select: text` 与 `overflow-wrap: anywhere`，保障极客调试体验。
4. **坚守关键几何修复与无障碍契约 (Preserved Guards & A11y Retained)**：
   - 完整保留 390px 视口下输入区模型弹窗的 fixed 定位与视口内部滚动约束，防止弹窗溢出或挤压界面。
   - 保持所有 `:disabled` 状态可读性（对比度 ≥ 4.5:1）、`[hidden]` 原生隐藏守卫、动态减弱媒体查询与 2px 键盘焦点环。

## 9 思考内容显示契约 (Reasoning Display, Web + Desktop)

共享 renderer（`src/renderer/**`）同时服务 Electron 桌面与 Web dev；CLI 走 `src/cli/render/reasoning.ts` 的单行 `✻` 预览，二者语义一致但呈现不同。以下为共享 renderer 的目标契约，标记的是设计意图，**不是**已通过验收的声明。

1. **数据来源与信任边界**：
   - 实时思考只来自 provider 下发的 `reasoning_delta` 事件（Chat Completions `reasoning_content` / Responses `reasoning_summary_text.delta`），由 `workbench-reducer.ts` 累积到 `ActiveRunState.streamingReasoning`（上限 `STREAMING_REASONING_LIMIT = 131072`，与 `docs/WEB_DEV.md` 的刷新恢复上限一致）。
   - 持久化思考只来自助手消息的可选 `reasoning` 字段（`schemas.ts` 上限 131072，展示专用）：不进入正文字段、不发送给模型、不进入事件日志、不是 `providerState`。
   - 思考文本是不可信纯文本；渲染必须经 `Markdown`/`StreamingMarkdown` 的安全路径（`skipHtml`、图片只显示替代文字、链接走已校验的 host bridge），不得直接注入 HTML。

2. **实时（live）思考**：运行中应在对话流末尾、助手正文之前，以可展开的单块形式流式显示当前轮的 `streamingReasoning`（`live` 态，标题“思考中…”），随增量原地增长；正文、工具调用、错误或运行结束时结束该块。实时块只显示文本本身，不伪造阶段、不伪造进度。

3. **持久（历史/已保存）思考**：`reasoning` 经 `Reasoning` 组件渲染为原生 `<details className="transcript-reasoning">`，**默认折叠**，摘要为“思考过程”；`live` 为 true 时才默认展开，并在 `live` 转 false 时收起。截断时在正文顶部给出明确的“已达显示上限”提示，不静默丢失。

4. **同步与去重**：思考的实时块与已保存消息由 `transcript-sync.ts` 的 `reasoningSaved` 独立判定；已保存消息acknowledge 同一段思考后必须移除对应的 `pendingReasoning`，避免重复显示。思考同步**不**触发整份 transcript 重取（`refresh-events.ts` 中 `reasoning_delta` 不参与 `shouldRefreshTranscript`）。

5. **无障碍与动态**：展开/折叠为键盘可达的原生 disclosure，带 `focus-visible` 焦点环；不使用颜色作为唯一状态表达；尊重 `prefers-reduced-motion`。

6. **当前实现差距（待修，不视为已满足契约）**：
   - 共享 renderer 的实时区域目前只渲染 `pendingOutputs` 与 `streamingText`，**未渲染** `streamingReasoning` / `pendingReasoning`，因此 Web/桌面在流式思考期间看不到任何实时思考文本（CLI 有单行预览）。
   - 已保存思考的 `Reasoning` 始终以 `live = false` 调用，`<details>` 默认折叠，且缺少“展开中”的实时态；用户需手动展开才能看到历史思考。
   - 相关单元测试未覆盖 renderer 的实时/持久思考渲染；`tests/renderer/refresh-events.test.ts` 只断言 `reasoning_delta` 不触发重取。

