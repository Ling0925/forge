# TUI → Ink 迁移与验收记录

## 当前架构

- 框架：Ink 6.6.0 / React / Yoga。生产入口为 `node-io → TerminalReader → InkController → InkApp → InkView`。
- 输入：唯一 `InputDecoder` 保留 UTF-8、跨 chunk 按键和 bracketed-paste 来源；不可变编辑状态和焦点 reducer 由 `InputStore` 管理，React `useSyncExternalStore` 订阅。
- 展示：Composer、ApprovalInput、Picker、SlashSuggestions、RichRow 独立组件；`dockLayout` 按实际终端高度统一分配预算，不再固定 20 行。
- 默认富终端使用备用屏幕；Ink/Yoga 固定高度根 Box、可伸缩消息区和不收缩的底部 dock，保留一行防止终端底部换行。完成历史与流式 tail 同属消息视口，不再向主屏 scrollback 追加；原 Shell 画面退出恢复。应用仅管理备用屏幕生命周期，绘制/光标刷新仍由 Ink 负责。
- 读屏模式保持行内输出（`useStdout().write`），不进入备用屏幕、不填充空白。两种路径都不使用无限累积的 Static 列表，不捕获鼠标。
- 普通 run / JSON / 管道采用最小 PlainController；不加载 Ink，不依赖旧手写 Screen。旧引擎已从 `src` 搬到 `tests/cli/legacy`，仅作历史行为 fixture，不进入 CLI 包。
- 模型、会话、权限、工具执行与存储协议不变。本机仍只编译 CLI，不安装、不更改启动器。

## 功能清单

| 功能 | 当前状态 |
| --- | --- |
| chat、resume、惰性创建、历史、会话命令 | 保留既有业务逻辑；新 Ink 默认入口 |
| 中文/emoji、多行、词/行编辑、历史、Slash 补全 | 不可变编辑函数；独立 React 输入组件 |
| 单一焦点、审批抢占、草稿/光标恢复 | 已实现；旧 picker 取消按 ID 隔离 |
| 粘贴防误确认、跨 chunk、FIFO、溢出 | 保留薄解码层；新增纯文本和 rich 回归 |
| Enter 排队、Alt/Shift+Enter 插话、模式/权限 | 既有语义保留 |
| 模型/思考/会话/任务选择器、刷新与停止确认 | Ink 组件；高窗口中保留少量实时 tail |
| Markdown、代码、表格、diff、工具/子代理卡片 | 保留 RichLine 生产者与控制清洗 |
| 状态、上下文、计划、待发预览 | 响应式预算；极矮窗口优先输入 |
| 未完成长回答阅读 | PgUp 冻结近期历史+当前 tail 快照，PgUp/PgDn 翻页，End/Esc 返回；后台继续运行 |
| 原生选择/复制 | 不捕获鼠标、不发 OSC52；阅读冻结期间不因后台输出破坏选区 |
| 长历史性能 | 近期阅读缓存 2000 行 / 1 MB；冻结快照 2000 物理行；全屏不累积延迟输出，存储不裁剪 |
| 输出唯一性 | 完成内容仅入历史一次；全屏只绘制可见切片，读屏行内路径用批次序号防重复交付 |
| light/dark/system | COLORFGBG + 一次有截止时间的 OSC11 探测；迟到响应不改主题 |
| NO_COLOR / TERM=dumb / 非TTY | 颜色禁用或纯文本降级 |
| 读屏模式 | INK_SCREEN_READER=true 接入 Ink 无障碍路径；关闭 timer-only 动画与 partial tail，完成输出保留 |
| 退出、EOF、SIGHUP/SIGTERM、取消 | 清理监听、查询/动画定时器、恢复 raw/paste；异常清理 finally 保证执行 |
| 输入历史、MCP、context、skills、checkpoints | 原业务保留 |

## 输入框架评估结论

检查已安装 Ink 6.6 `hooks/use-input.js`：它按输入 chunk 调用 `parseKeypress`，对外暴露 input/key，但没有 bracketed-paste 来源字段；hook 还会管理 raw mode 和输入事件监听。直接替换会丢失审批所需的粘贴来源，并与现有唯一 decoder 争夺输入。因此**保留薄解码层是明确设计决策，不再把“全部交给 useInput”列作迁移完成条件**。编辑/焦点规则是应用逻辑，渲染/布局/差异刷新由第三方 Ink 承担。

## 完成情况

- [x] Ink 默认入口与展示组件。
- [x] 输入/焦点独立 store、React 订阅、审批/选择器组件化。
- [x] 实际高度布局、未完成输出阅读、阅读期间暂停绘制。
- [x] 去除无限 Static 历史及每次追加复制整个历史的路径；有界缓存与布局复用。
- [x] 最小纯文本控制器，生产依赖移除旧手写屏幕。
- [x] 系统主题探测、读屏模式、终端模式生命周期与断线信号清理。
- [x] 当前 CLI/选择复制文档统一；旧 UI 演进文档保留历史性质。
- [x] 新 Ink Chromium/xterm、真实 PTY、状态/输入/性能上限回归。

### 环境验收边界（不能用自动测试冒充）

- 本机 Chromium/xterm 和 Linux PTY 已覆盖；SSH 远端连接、tmux 多版本、macOS/Windows 终端和真实读屏软件仍需对应环境人工验收。
- 没有用真实密钥发模型请求；持续流式行为使用合成 renderer 输入。没有做桌面构建、安装或正式发布验收。
- 原生复制依赖终端自身快捷键与剪贴板设置，Forge 不承诺跨所有宿主组合的 OS 剪贴板结果。

## 配色迁移补齐

- `src/cli/palette.ts` 是 CLI 唯一颜色 token 源，`theme.ts` 与 Ink `RichRow` 共用；不再存在实时/历史两套 diff 和上下文色板。
- 保留 DESIGN.md 亮暗鼠尾草、灰阶、成功/警告/错误色，以及原 CLI 256 色 diff 底色/词级强调。普通正文和画布仍由用户终端决定。
- 颜色能力从实际 UI 输出流读取，支持 24-bit/256/16 色；未知背景采用终端原生 ANSI 语义色。NO_COLOR、dumb 和单色模式不输出 SGR。
- 审批输入缓存按 warning tone 构建；无色/单色输入点保持可见。第三方 Ink 继续负责布局和屏幕刷新，只有清洗后的文字与可信主题 SGR 进入 Text。
- 新增 `palette.test.ts` 与 `ink-colors.test.ts`，在真实 Chromium/xterm 逐格对比前景/背景/粗体/反色：light/dark/system × 16/256/真彩 × 彩色/无色共 18 组；另验默认主题探测超时、选择器和审批。
- 编译产物 PTY 测试扩展为无色、亮色、暗色三个启动场景，用临时 HOME/FORGE_HOME，直接断言真实鼠尾草 SGR，不仅断言文案。
- 本次配色验证：`pnpm exec vitest run tests/cli/palette.test.ts tests/cli/ink-colors.test.ts tests/cli/theme-v2.test.ts tests/cli/diff-theme.test.ts tests/cli/ink-bundle.test.ts tests/cli/ink-view.test.ts tests/cli/ink-terminal.test.ts tests/cli/ink-xterm.test.ts tests/cli/format.test.ts tests/cli/tool-cards.test.ts tests/cli/context-footer.test.ts tests/cli/diff-accuracy.test.ts`：12 文件 / **118 项通过**；原主题对比度测试仍通过。限定严格类型检查、CLI 编译和产物语法检查通过，未执行全仓库测试。

## 全屏固定输入补齐

按用户选择，默认富终端切换全屏，而不是继续兼容主屏 scrollback。根 Box 使用终端高度减一，消息区 `flexGrow`，输入/状态 dock `flexShrink=0`；Slash 建议向上展开。屏幕切换仅在 Ink 挂载时启用，退出恢复；未挂载审批、普通文本和读屏模式不切换。

本轮检查：`pnpm exec vitest run tests/cli/ink-bundle.test.ts tests/cli/ink-xterm.test.ts tests/cli/ink-view.test.ts tests/cli/ink-modes.test.ts tests/cli/ink-terminal.test.ts tests/cli/ink-app.test.ts tests/cli/ink-colors.test.ts tests/cli/ink-transcript.test.ts tests/cli/interactive.test.ts`：**9 文件 / 123 项通过**。真实 xterm 断言输入行坐标（24行终端无额外底栏时为第23行）、消息历史翻页、原生选区冻结、审批/菜单/选择器、仅高度及宽高缩放、原Shell画面恢复；读屏无整屏填充。限定严格类型检查、CLI编译、产物语法与亮/暗/无色PTY启动退出通过。

## 测试与历史基线

当前验证命令：

```sh
node scripts/build-core.mjs
pnpm exec vitest run tests/cli
node --check dist/cli.mjs
```

限定严格类型检查覆盖新 Ink controller/reader 及新增测试，开启 strict、exactOptionalPropertyTypes、noUncheckedIndexedAccess；不把全仓 typecheck/lint 作为本机编译前置。

新增/扩展：`ink-transcript.test.ts`（10000 行缓存与延迟输出上限）、`ink-xterm.test.ts`（完成历史唯一、未完成阅读、选区冻结、缩放、混合宽字符草稿）、`ink-modes.test.ts`、`plain-controller.test.ts`、`ink-terminal.test.ts`（读屏/断线/审批抢占）。PTY 测试始终使用临时 HOME/FORGE_HOME 并清理。

旧测试迁到 legacy fixture 后保留断言。旧 `terminal-v2-xterm.test.ts` 同时要求 inline scrollback 与后来已改为 alternate 的默认引擎，且在 inline 模式末段混合宽字符缩放仍失败；已完整归档为 `tests/cli/legacy/inline-xterm.scenario.ts`（不是通过的验收）。它被新 `ink-xterm.test.ts` 的实际 Ink 场景替代，没有把失败改成跳过后声称旧引擎已修复。

上一轮迁移基线：`pnpm exec vitest run tests/cli` **65 文件 / 643 项通过**（包含新 Ink xterm 和隔离 HOME 的 PTY 启动退出）；CLI 编译、产物语法和限定严格类型检查均通过。没有运行桌面或整个仓库测试。

此前阶段基线：阶段1 154项；阶段2 185项。
