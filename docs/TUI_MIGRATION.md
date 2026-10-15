# TUI → Ink 迁移与验收记录

## 当前架构

- 框架：Ink 6.6.0 / React / Yoga。生产入口为 `node-io → TerminalReader → InkController → InkApp → InkView`。
- 输入：唯一 `InputDecoder` 保留 UTF-8、跨 chunk 按键和 bracketed-paste 来源；不可变编辑状态和焦点 reducer 由 `InputStore` 管理，React `useSyncExternalStore` 订阅。
- 展示：Composer、ApprovalInput、Picker、SlashSuggestions、RichRow 独立组件；`dockLayout` 按实际终端高度统一分配预算，不再固定 20 行。
- 完成输出经 Ink `useStdout().write` 提交，框架负责清除/恢复动态区域；不再使用会不断累积历史字节的 Ink Static。应用不自行发送光标移动/鼠标/备用屏幕序列。
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
| 长历史性能 | 近期阅读缓存 2000 行 / 1 MB；冻结快照 2000 物理行；延迟输出 2 MB，超限明确提示，存储不裁剪 |
| 输出唯一性 | 完成批次序号防重复交付；不把未完成快照追加为历史 |
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

本轮最终：`pnpm exec vitest run tests/cli` **65 文件 / 643 项通过**（包含新 Ink xterm 和隔离 HOME 的 PTY 启动退出）；CLI 编译、产物语法和限定严格类型检查均通过。没有运行桌面或整个仓库测试。

此前阶段基线：阶段1 154项；阶段2 185项。
