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

模型选择器在触摸设备或窄于 769px 的屏幕上不自动聚焦搜索，避免打开软键盘。模型目录按服务地址与协议缓存到本地，无定时失效；打开面板只使用已有缓存，刷新按钮才重新请求。切换服务来源时独立加载目录，失败保留上次成功数据。

模型与思考等级共用一个触发器和面板。模型名称可省略，末尾固定保留五格等高竖条（3px 宽、2px 间距、统一高度 11px），以 accent-sage 点亮极低至极高的 1–5 格；自动与关闭不填格并标注“自/关”。面板使用七档原生滑块，拖动预览、松手保存，支持方向键和 Home/End，保存期间禁用。8px 轨道内仅最高档播放 2.4 秒轻微流光，裁切在已填充区域内；减少动态效果时静态高亮。当前档位通过文字和 aria-valuetext 提供，桌面与手机采用相同语义。

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
   - **命令卡片（`run_command`）默认展开且极简**：只显示执行的命令与其原始结果，不再渲染"参数输入"或解析后的结果键值行（那会与命令行重复、显得杂乱）。命令与结果作为一体呈现；cwd 仅在存在时附在命令下方。
   - **编辑文件卡片（`edit_file`/`write_file`）默认展开**，**只显示差异**：不再渲染"参数输入"里的"原内容/新内容"原文（那只是差异的重复）。
   - **差异来源优先用 `change.patch`**：`FileChange.before/after` 只是**截断到 8192 字符的开头预览**（`src/tools/local.ts` 的 `PREVIEW_LIMIT`），当改动发生在预览窗口之后时两个预览会完全相同，不能据此判定"无改动"。真正的精确差异由工具在**完整原文**上生成并存入 `change.patch`（`createDiffPatch`，含精确 `added`/`removed` 与上下文 hunk，CLI 早已使用）。因此 `DiffViewer` 优先渲染 `patch.hunks`；只有没有 `patch` 时才回退到 before/after 预览对齐。没有可显示内容时区分"（无文本改动）"与"（精确差异不可用：内容超出计算预算）"，绝不把未知当零。
   - 差异渲染时**只保留变更行及其上下各 5 行上下文**（`DIFF_CONTEXT_LINES`，共享 `src/shared/diff.ts` 的 `CONTEXT` 与之一致），被省略的未改动区段折叠成一行"⋯ 已省略 N 行未改动内容 ⋯"。差异**默认只预览前 10 行**（`DIFF_PREVIEW_LINES`），带"展开全部差异（还有 N 行）"控件，展开后进入有界的可滚动区域（`max-height: 480px`）。行数上限 2000 行，超出提示已截断。
   - **标题栏增删计数**：文件改动卡片在标题栏右侧以颜色显示本次改动的行数统计——绿色 `+N`（新增）、红色 `-M`（删除），来自 `diffStats(change)`（优先取 `patch` 的精确计数，未知则为 null 且不显示），跨多个文件累加。
   - 其他工具的展开视图展示代码格式的真实参数与工具输出，保留完整退出码与错误原因，无夸张边框。
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

The composer reserves a 28px activity row above the input to keep controls stationary across run transitions; the activity indicator itself remains 20px high. Only the selected live run fills it. Three 3px by 12px bars use the existing accent ink and a staggered 1.2s scale/opacity rhythm; 12px text identifies execution, approval waiting or cancellation. Approval and cancellation stop the rhythm, terminal states clear the indicator, and reduced-motion uses static bars. No progress percentage or timer is invented. This uses native CSS with no animation dependency; the external loader reference was unreachable during implementation.

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
  also recalculate height. The send and stop buttons live in a dedicated 44px
  right column beside the input without overlaying text. Below the input sits a
  single unbordered toolbar row with mode and permission icons aligned left, a shrinkable
  right-aligned model group opening the model panel where the source chooser and seven-step
  reasoning effort range reside. Composer notices, activity, queue actions,
  errors and hints remain above the input in normal DOM and visual order,
  keeping the input itself clear; conversation approval surfaces outside this
  composer remain unchanged.
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

## 图片附件

图片入口沿用左侧工具栏的 44px 点击区域、16px 图标和 12px 圆角，发送按钮仍位于输入框右侧，模型信息保持右对齐。
附件与错误提示位于输入框上方；缩略图采用 80px 方形区域、8px 间距与现有表面、文字和圆角 token，文件名单行省略。
删除控件使用真实 44px 点击区域；多图在窄屏内横向滚动，不能撑宽页面。
历史缩略图通过现有 Dialog 查看原图，支持 Escape 关闭与焦点返回；读取指示遵循减少动态效果设置。
每个会话独立保留尚未发送的附件，确认发送后只移除本次捕获的图片；发送失败保留草稿。

## 9 思考内容显示契约 (Reasoning Display, Web + Desktop)

共享 renderer（`src/renderer/**`）同时服务 Electron 桌面与 Web dev；CLI 走 `src/cli/render/reasoning.ts` 的单行 `✻` 预览，二者语义一致但呈现不同。以下为共享 renderer 的目标契约，标记的是设计意图，**不是**已通过验收的声明。

1. **数据来源与信任边界**：
   - 实时思考只来自 provider 下发的 `reasoning_delta` 事件（Chat Completions `reasoning_content` / Responses `reasoning_summary_text.delta`），由 `workbench-reducer.ts` 累积到 `ActiveRunState.streamingReasoning`（上限 `STREAMING_REASONING_LIMIT = 131072`，与 `docs/WEB_DEV.md` 的刷新恢复上限一致）。
   - 持久化思考只来自助手消息的可选 `reasoning` 字段（`schemas.ts` 上限 131072，展示专用）：不进入正文字段、不发送给模型、不进入事件日志、不是 `providerState`。
   - 思考文本是不可信纯文本；渲染必须经 `Markdown`/`StreamingMarkdown` 的安全路径（`skipHtml`、图片只显示替代文字、链接走已校验的 host bridge），不得直接注入 HTML。

2. **实时（live）思考**：思考中在对话流末尾、助手正文之前显示一个**自定义**（非原生 `<details>`）组件：标题行“思考中”（`Brain` 图标，带 `reasoning-pulse` 脉冲，尊重 `prefers-reduced-motion`），下方是一个固定高度（5 行）的**自动滚动视口**，只保留最新的若干行并随增量滚动到底，避免反复刷屏。到达答案正文（`streamingText` 非空）或运行结束时该块结束。实时块只显示文本本身，不伪造阶段、不伪造进度。

3. **持久（历史/已保存）思考**：结束后**只显示最后一行思考内容**作为静默摘要（单行、省略号截断），保证历史记录紧凑、不反复刷屏；点击标题行可展开查看完整思考（`Markdown` 安全渲染），再次点击收起，并带 `CaretRight` 旋转指示。截断时在展开正文顶部给出明确的“已达显示上限”提示，不静默丢失。

4. **同步与去重**：思考的实时块与已保存消息由 `transcript-sync.ts` 的 `reasoningSaved` 独立判定；已保存消息acknowledge 同一段思考后必须移除对应的 `pendingReasoning`，避免重复显示。思考同步**不**触发整份 transcript 重取（`refresh-events.ts` 中 `reasoning_delta` 不参与 `shouldRefreshTranscript`）。

5. **无障碍与动态**：摘要行为为原生 `<button>`（键盘可达、`aria-expanded`、`focus-visible` 焦点环、`aria-label` 保留完整摘要文本），不使用颜色作为唯一状态表达；实时视口脉冲与展开指示在 `prefers-reduced-motion: reduce` 下停止动画。

6. **实现状态**：
   - `Reasoning` 已改为自定义组件：思考中渲染 `.reasoning-live`（`Brain` + “思考中” + `.reasoning-viewport` 自动滚动，`REASONING_LIVE_LINES = 5`，DOM 仅保留尾部 `LIVE_TAIL_LINES = 60` 行）；结束后渲染 `.reasoning-done`（`lastReasoningLine` 取最后非空行作摘要，点击展开 `.reasoning-full`）。
   - `Transcript` 在助手正文之前渲染 `run.pendingReasoning`（已保存但未同步）与 `run.streamingReasoning`（live）；答案开始后同一块由 live 切换为 done；思考增量参与自动跟随滚动。
   - 覆盖：`tests/renderer/reasoning-mounted.test.ts` 断言实时视口存在且滚动到底、无原生 `<details>`、结束后只留最后一行摘要、点击可展开、持久思考为独立摘要。
   - 仍未覆盖：真实 provider 端到端推理流、窄屏/高对比/读屏矩阵、超长（>131072）思考的真实截断表现。

## 10 一体化输入舱与移动端命中区精修 (Composer & Touch Refinement)

本轮针对真实 DOM 测量结果修正实现与契约之间的偏差。测量方式：esbuild 挂载真实 `App`，用 Chromium 读取 `getBoundingClientRect` 与 `getComputedStyle`，覆盖 1440/1280/834/390/360px × 亮暗双主题；不依赖截图观感。

1. **输入舱收敛为单一卡片**：`composer-prompt` 不再自带 `composer-surface` 外框。改为 `.composer-card.composer-surface` 包住「输入行 + 工具栏行」，两者共用同一张 18px 圆角白面、同一条 1px 边线与同一层阴影。此前实测卡片 708px、工具栏 760px、用量条 760px 三段错位且工具栏浮在卡片之外；现三者同宽（760px），工具栏在卡片内部。
2. **输入行等高对齐**：提示列固定 `4px + 36px + 4px = 44px`，与右侧 44px 发送按钮严格等高同顶。装饰性 `.composer-mode-arrow` 改为 `display:none`（原为 0×0 的 flex 子项，仍占用 8px gap，把提示列顶到 50px）。
3. **聚焦只有一处**：卡片是唯一焦点表达（`:focus-within` 边框 + `:has(.composer-textarea:focus-visible)` 焦点环），输入框本身保持无框，避免「框套框」。
4. **用量条对齐卡片**：`.composer-usage` 左右内缩 13px，使进度条端点与卡片文字边对齐，而不是宽出卡片。整条用量行是唯一控件，因此整行可点（负外边距让 hover 底仍对齐）。
5. **排版基线统一**：正文 `--prose-size` 16px / 1.75（桌面）、17px / 1.75（窄屏），用户气泡与助手正文同字号同行高；输入框按 §5.2 保持 15px，模型标签同步 15px 以形成同一字体系统。
6. **节奏**：会话内块间距 12px，人工轮次另加 16px，阶段边界落在 28px 区间，符合 §1.3 的 28–36px 呼吸感。
7. **状态色对比度修正**：浅色主题 `--success` / `--warning` / `--error` 由 `#10b981` / `#d97706` / `#ef4444` 改为 §2 表中的 `#226d40` / `#975a06` / `#b82420`，对各自浅底实测 5.75 / 5.21 / 5.83:1（原为 2.41 / 3.07 / 3.44:1，均不达标）。深色主题原有取值实测 5.06–8.97:1，保持不变。
8. **待审批 pill 与角标**：hover 反色不再使用固定白色文字（深色主题下 `#ffffff` on `#fbbf24` 仅 1.67:1），改用 `--warning` / `--warning-bg` 配对；移动端角标同样改用该配对。实测亮暗分别为 5.21:1 与 8.97:1。
9. **移动端命中区**：≤1000px 顶部导航的会话/任务/详情/设置全部 44px（原 32 / 26 / 32px），分段控件内高 40px。导航高度由 44px 目标自身撑开，主区改用 flex 剩余空间，不再用 `100dvh - 固定值` 硬算（原实现按 48px 假设计算，而导航实际为 59px）。
10. **去除重复入口**：≤1000px 时隐藏任务头部的设置齿轮，仅保留顶部导航中的设置入口；头部三个控件（详情、会话操作、设置）统一为 32px 方框与 4px 间距。
11. **侧栏与辅助控件**：品牌徽标改为鼠尾草软底；新建任务按钮 32px 高并占满侧栏宽度；搜索框与归档切换 32px（粗指针 44px）；会话标题 13px/450、激活态 500；首次使用概览改为单条细线上方的平铺两列（不再卡片套卡片），指标值 20px/600。
12. **证据行命中区**：`tool-debug-summary` 与用量触发条补足 28px（粗指针 44px）真实命中高度并带 hover 反馈。

以上为已实现并通过上述测量的状态，仍**不是**完整验收声明：未覆盖真实 provider 端到端运行、读屏与高对比矩阵、200% 缩放的逐屏人工检查。

## 11 对话流作者层级、去重与整段复制 (Transcript Authorship & Sync)

测量方式同 §10：esbuild 挂载真实 `App` / 真实 `Transcript`，Chromium 读取几何与计算样式，逐步推进 reducer 状态。

1. **作者标签对称**：用户消息保留 12px「你」+ 鼠尾草微点；助手消息新增同规格作者行「Forge」。两者共用 `.message-header` 的字号、字重与微点，避免此前「用户有作者、助手只在流式时有」的不对称。
2. **阶段标题不再冒充作者**：`StageHeader` 只有在 `transcriptStages` 给出**真实 AI 计划步骤名**时才渲染，且只渲染步骤名（12px/500 + 一条装饰性细线延伸到栏宽）。此前每条助手消息上方都有一行只有「Forge」的 12px 小字，与作者行重复；现在无计划步骤时该行完全不存在。
3. **流式草稿与已保存消息不再重复**：`SET_ACTIVE_SNAPSHOT` 在快照已包含本轮 `streamingText` 时清空该缓冲（前缀匹配，滞后快照不会误清）。实测修复前 `saved` 阶段同一段文字同时出现两份（已保存消息 + 实时草稿）直到运行结束；修复后 `streaming` 块数为 0。
4. **草稿→保存零跳动**：作者行高度固定为 22px（细指针），草稿块与保存块实测同为 54px、`top` 完全相同；修复前保存后高度 54→28+20，底部位移 34px。
5. **思考块状态不被去重破坏**：`live` 判定改为「本轮是否已产出答案正文」（流式或已保存），不再依赖 `streamingText`。清空草稿后已完成的思考仍保持 `.reasoning-done` 折叠摘要，不会回退成「思考中」；流式思考缓冲仍按 §9 保留到运行结束。
6. **整段复制**：助手作者行右侧提供「复制」按钮，复制消息的原始 Markdown 文本（不是渲染后的 DOM 文本）。它是原生 `<button>`，`aria-label` 在「复制整段回答 / 已复制整段回答」间切换，2 秒后复位；剪贴板不可用时**不**切换文案（不谎报成功）。位于作者行内、`margin-left: auto` 右对齐，不覆盖正文、不引起位移。细指针 22px 高，粗指针 44px。实测对比度 4.84:1。

仍未覆盖：真实 provider 端到端流式运行、读屏逐条朗读顺序、高对比模式下的复制确认态。


