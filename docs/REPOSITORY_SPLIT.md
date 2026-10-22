# Web UI / CLI / Core 独立仓库拆分

## 范围与基线

本次按用户要求先拆 Git 仓库，不进行 Rust 移植或默认单实例 daemon 改造。
原库已提交基线为 `e089acbcf1c3fe10a71a9ce0fce5f9309305db3b`。
三个新仓位于当前工作区的 `repos/` 中，各自拥有独立 `.git`，不是子模块、
不是 worktree，也不是同一个 monorepo 中的三个目录。

| 仓库 | 路径 | 职责 |
| --- | --- | --- |
| Core | `repos/forge-core` | 运行时、Provider、存储、工具、上下文、MCP、共享契约、host 与 HTTP/WebSocket API |
| CLI | `repos/forge-cli` | 命令行入口、TUI、终端渲染、CLI 测试与 Ink patch |
| Web UI | `repos/forge-web-ui` | React renderer、Web 构建、开发/启动装配及界面测试 |

使用 `git-filter-repo 2.47.0` 在三个新建的非硬链接 clone 中按相关路径过滤历史。
作者和相关路径的提交历史保留，过滤后提交 ID 会变化。原仓历史没有重写。
新仓不配置远端，未创建 GitHub/GitLab 项目，也没有 push；以后分别设置新远端，
不要把过滤后的历史推回原仓。

`repos/` 在原仓 `.gitignore` 中忽略，避免误提交为嵌套仓或 gitlink。
**只克隆这个原仓不会得到三个新仓**：需要分别备份、克隆或推送它们。
三库可以整体移动到别的位置，彼此保持同级即可；不依赖原库源码。

## 包边界

Core 提供 `@forge/core` 包，CLI/Web 通过声明的 `file:../forge-core` 本地包依赖
使用它，不复制核心和共享契约，不通过 `../../desktop-harness/src` 访问原库。
`@forge/core/shared/*` 是浏览器可用契约，其余 Node 实现不应进入浏览器包。
后续配置内部 registry 或 tarball 依赖时无需重新合并仓库。

先在 Core 安装并构建，再分别安装/构建 CLI 与 Web UI。精确入口和聚焦检查见
各仓的 `README.md`。Core 修改后重新构建，并重新安装消费者的本地文件包依赖。

## 保留项与非目标

- 原库保留，供现有本机 CLI/桌面入口继续工作，不删除或覆盖启动器。
- 原有 `src/renderer/components/workbench/ModelPicker.tsx` 与
  `src/renderer/styles/settings-models.css` 的未提交修改只留在原库，未混入新仓提交。
  后续需要时应人工审阅后迁入 Web UI 仓；不要把两份源码当成自动同步。
- Electron 桌面壳与现有 Android WebView 工程仍留在原库；它们不被冒充为 Web UI。
- 原库中的跨客户端集成测试保留。各新仓只承担自身职责的测试，拆分后迁移或
  尚未迁移的覆盖应以各仓文档和实际测试结果为准。
- 本次没有改变会话格式、Provider 行为或默认进程所有权。单独启动 CLI 与 Web
  仍可能各自创建核心。统一 daemon、Rust 内核、原生 Android 是后续独立步骤。
- 本机 `forge` 仍运行旧 `desktop-harness/dist/cli.mjs`，新 CLI 需要显式运行
  `repos/forge-cli` 的构建产物。本次没有发布、安装、修改桌面入口或正式打包。

## 本轮提交与验证

| 仓库 | 本轮最终提交 | 已验证 |
| --- | --- | --- |
| Core | `6d907f2` | 独立构建；14 个聚焦 Vitest 文件共 92 项通过；4 项构建包检查通过（浏览器契约、离线回合持久化、无 UI 的 API 启动等） |
| CLI | `4fe4d6e` | 独立构建、类型/包边界检查；64 项聚焦测试与 2 项真实产物烟测通过，production bootstrap 保持独立 |
| Web UI | `3c06a8c` | 独立构建；103 项聚焦单元/渲染/浏览器测试通过；真实生产入口的 Chromium 导航、CSP、RPC 与可选 socket 检查通过 |

- CLI 扩展测试为 791 通过、4 未通过：3 项需要外部 xterm Unicode11 QA 附件；
  1 项为 `ink-view` 的 24×8 dock 顺序断言，已在未拆分的原库同一用例上复现。
  本轮没有为迁移而改变旧窄屏布局或把失败静默跳过。
- Web UI 全量 typecheck/lint 尚未通过；CLI lint 也仍有诊断。本轮没有逐条修复
  或完成全部错误的基线归因，不把构建或聚焦测试通过表述为“全量验收通过”。
- 启动/浏览器检查使用临时状态，不使用真实密钥，不调用真实 Provider；检查后
  服务和浏览器已关闭。没有做桌面/Android 构建或正式发布打包。
- 三个仓库使用独立 Git common directory，均未配置远端；原仓索引中没有
  `repos/` 文件或 gitlink。构建产物与依赖目录没有进入提交。

## 后续工作顺序

1. 在三个独立仓中继续开发；根据需要指定各自远端并显式推送。
2. 单独设计语言无关协议、daemon 单实例所有权与完整 CLI 客户端接入。
3. 在 Core 仓进行 Rust/Linux/Android 原型与行为对照迁移，不重写 UI 仓。

原仓只提交本说明和嵌套仓忽略规则；三个新仓分别提交自己的构建、包依赖、
入口和测试调整。真实配置、运行状态、依赖目录与构建产物均不应进入提交。
