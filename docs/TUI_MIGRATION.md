# TUI → Ink 迁移清单

## 目标与边界

使用第三方 TUI 框架 **Ink 6.6.0（React + Yoga）** 替换自写屏幕引擎，逐步迁移，而不是一次同时重写会话、运行和终端协议。该版本兼容仓库现有 Node 22 / React 19；版本与传递依赖固定在 lockfile。

默认 rich TTY 入口：`node-io.ts → TerminalReader → InkController → InkView`。

- Ink `Box` / `Text` / `Static` 负责组件、布局、终端输出和差异刷新。
- `TerminalUI`、`interactive.ts`、事件渲染器及 core/store 不改业务语义。
- 第一阶段仍复用 `InputDecoder`、`Editor`、输入队列和 fresh approval 生命周期；输入只有一个所有者，不能同时启用另一套输入监听。
- 不再启用备用屏幕或鼠标捕获。已完成输出进入终端原生 scrollback，使用终端自身的滚动、选择、复制；旧的应用内鼠标选区、OSC52 自动复制和 Ctrl+G 复制模式不再是新界面的路径。
- 运行中的 tail 仅显示有界预览，完成后完整内容进入 `Static`。不把预览裁切写回会话。
- 普通 `run` / JSON / 管道模式不加载 Ink；单次运行的审批仍保留普通文本输入路径。
- 构建将 Ink/React 保留为运行时依赖，不把其可选 DevTools、Yoga 加载器强行塞进 CLI 单文件。只执行本机 CLI 编译，不重装、不更改启动器。

## 现有功能基线与迁移验收

“保留”表示继续由现有业务/渲染模块提供，不等于全部已经做过真实终端验收。

| 功能域 | 现有功能 | 第一阶段实现 / 验收依据 |
| --- | --- | --- |
| 入口与会话 | 默认 chat、`chat --session`、`resume`；惰性建会话；历史展示 | 保留 interactive，默认 rich 适配器切换 Ink；`interactive.test.ts` |
| 会话命令 | `/sessions /resume /new /fork /rename /archive /compact /diagnostics /export` | 保留命令路由；选择器用 Ink 展示 |
| 输入编辑 | 中文/emoji 字素、左右/词移动、Home/End、删除、Ctrl+U/K/W、历史上下键 | 暂复用 Editor，Ink 绘制草稿与插入点；`ink-terminal.test.ts` |
| 多行与粘贴 | 行尾反斜杠换行、bracketed paste、跨 chunk UTF-8、CRLF、粘贴不提交 | 暂复用解码器；专项覆盖多行、分段粘贴 |
| Slash 菜单 | 输入过滤、上下选择、Tab 补全、Enter 提交、Esc 保留草稿 | Ink 菜单 + 现有命令目录；专项覆盖 |
| 运行控制 | Enter 排队、Alt/Shift+Enter 插话、`/steer /queue`、失败暂停队列 | 保留 run queue；专项验证一次提交；`run-input.test.ts / run-controls.test.ts` |
| 模式与权限 | `/mode`、Shift+Tab、`/permission`、`/approval full-access / auto / manual` | 业务逻辑保留；Ink mode 标记与快捷键桥 |
| 模型与思考 | `/model`、`/reasoning`、`/thinking`、启动 thinking 参数 | 保留配置和事件生产者；选择器用 Ink |
| 回复呈现 | Markdown、代码高亮、表格、链接、流式文本、折叠/展开思考 | 保留安全 RichLine 生产者，Ink Text 显示语义样式 |
| 工具与子任务 | 工具卡片、参数/结果、耗时、diff/词级高亮、子代理进度；`/tools` | 保留 tool transcript；Ink span 颜色与背景映射 |
| 状态栏 | spinner、耗时、生成 token、工具数、取消提示 | Ink 状态组件；观察会话不显示伪造运行指标 |
| 上下文与计划 | 模型/思考强度/会话名、上下文计量、缓存命中；`/plan` | 复用纯 footer 格式化，Ink 当前计划步/页脚；窄屏降级 |
| 通用选择器 | 搜索、默认选中项、详情、空列表、取消、活动标记 | Ink 组件；刷新按 value 保留选择；专项覆盖 |
| 任务面板 | `/tasks` 子代理/后台命令、分页、结果、轮询刷新、停止确认 | 保留 tasks service；补通 `updatePicker`；`tasks-integration.test.ts` |
| 审批 | 父/子任务来源、argv；新鲜 Enter/y、拒绝、Esc/Ctrl+C、草稿恢复 | fresh reader 保留；粘贴/历史输入不得变成许可；专项覆盖 |
| 输入历史 | `/history on / off / clear / status`，工作区隔离、默认关闭、敏感模式过滤 | 保留 prompt-history store；输入桥继续调用原回调 |
| 项目辅助 | `/context /skills /checkpoints /mcp /help /quit /exit` | 保留原命令，不新增执行能力 |
| 终端生命周期 | resize、Ctrl+C、Ctrl+D、EOF/error、重复 dispose、输入溢出 | Ink 释放渲染，reader 释放监听/队列，桥恢复 raw/paste；专项覆盖 |
| 滚动/复制 | 原自写历史滚动、鼠标选区、OSC52、Ctrl+G | 改为终端原生 scrollback/选择复制；不再劫持鼠标 |
| 主题与安全 | light/dark/system、NO_COLOR、ANSI/OSC 控制清洗 | Ink span 边界仍清洗；系统主题探测和终端兼容性列入后续验收 |
| 非交互协议 | stdout/stderr 分离、JSON、显式 stdin、退出码 | 保留原路径；`machine-golden-v2.test.ts`；独立 HOME 编译产物检查 |

## 分阶段路线

### 阶段 1：框架与显示层（本轮）

- [x] 引入 Ink，隔离其渲染实例与生命周期。
- [x] 默认 rich CLI 改用新适配器；非 TTY 保持旧纯文本路径。
- [x] 实现 transcript/tail、composer、选择器、slash 菜单、状态、计划、上下文和 pending preview。
- [x] 不接管备用屏幕和鼠标，恢复终端原生滚动/复制。
- [x] 新增输入、审批、刷新、清理专项回归测试。
- [x] 编译产物 PTY 启动检查、模式恢复检查与非交互输出检查。

### 阶段 2：输入组件与交互状态

- [ ] 把 Editor/快捷键桥迁为可独立测试的 React 输入组件，评估成熟输入组件的多行/CJK/粘贴能力。
- [ ] 保留显式 paste provenance；不能因使用框架通用 `useInput` 丢失审批防误触能力。
- [ ] 组件化选择器的输入/焦点状态，保留业务层取消、任务刷新和草稿恢复。
- [ ] 验收屏幕阅读器、系统主题探测和各平台快捷键差异。

### 阶段 3：清理与兼容性验收

- [ ] 将旧 Controller/Screen/view/selection 专属测试替换为新实现的行为测试，再删除无用路径；旧纯文本 reader 拆分为最小实现。
- [ ] xterm/SSH/tmux 与不同终端的缩放、原生滚动选择、超长历史、大粘贴人工验收。
- [ ] 对长会话 Static 保留量、帧率、启动时间做有界性能检查。
- [ ] 清理旧 UI 文档的过时快捷键，统一新交互文档。

## 验证记录

- 聚焦回归：`pnpm exec vitest run tests/cli/ink-terminal.test.ts tests/cli/ink-view.test.ts tests/cli/ink-bundle.test.ts tests/cli/interactive.test.ts tests/cli/terminal.test.ts tests/cli/run-input.test.ts tests/cli/run-controls.test.ts tests/cli/approval-policy.test.ts tests/cli/tasks-integration.test.ts tests/cli/prompt-history.test.ts tests/cli/machine-golden-v2.test.ts tests/cli/resumed-session.test.ts`。
- 上述 12 个文件共 **154 项通过**。其中新增 Ink 输入/生命周期 14 项、展示组件 8 项、编译产物 2 项；组件覆盖 80×24、24×8、8×4、2×2 的动态区域边界。
- 编译：`node scripts/build-core.mjs`；语法：`node --check dist/cli.mjs`。
- 类型检查限定到 `src/cli/ink/controller.ts` 和三个新增测试入口，启用 strict、exactOptionalPropertyTypes、noUncheckedIndexedAccess；未执行全仓库 typecheck/lint/打包。
- PTY 检查使用 Linux `script` / `stty`，临时 HOME/FORGE_HOME，启动编译后的 chat 并发送 `/quit`；确认不进入备用屏幕/鼠标捕获、不清 scrollback、退出恢复 paste/cursor。测试结束清理临时目录，不读取真实会话或密钥。
- `pnpm peers check` 仍报告原有 Vite 8 / esbuild 0.25 的版本要求不匹配（不是 Ink peer）；本轮不升级无关构建依赖。

未验证：真实模型长时间流式交互、SSH/tmux、各终端原生选择体验、屏幕阅读器。system 主题先使用 COLORFGBG，未知背景保留终端默认前景；OSC 背景探测待下一阶段。现有旧终端单元测试仍是迁移基线，不应拿它们通过来声称新 Ink 界面全部验收完成。
