# 主仓 + Core / CLI / Web UI 子模块

## 当前仓库组织

原 `desktop-harness` 工作区对应的 `Ling0925/forge` 作为主仓（Git superproject），
通过 `.gitmodules` 和 Git gitlink 固定三个独立仓库的版本：

| 仓库 | 主仓内路径 | GitHub 仓库 | 职责 |
| --- | --- | --- | --- |
| Core | `repos/forge-core` | `Ling0925/forge-core` | 运行时、Provider、存储、工具、上下文、MCP、共享契约、host 与 HTTP/WebSocket API |
| CLI | `repos/forge-cli` | `Ling0925/forge-cli` | 命令行入口、TUI、终端渲染、CLI 测试与 Ink patch |
| Web UI | `repos/forge-web-ui` | `Ling0925/forge-web-ui` | React renderer、Web 构建、开发/启动装配及界面测试 |

主仓和三个子仓均为公开仓库，子模块使用 HTTPS 地址。读取不需要私有仓库权限，
推送仍需要对应仓库的写权限；公开可见性不改变现有许可文件。

主仓记录的是**每个子仓的一个确定提交**，不是自动跟随 `master` 最新版本，也不把
子仓源码重新复制进主仓。各子仓仍有自己的历史、分支、远端、依赖与构建入口，可
独立克隆、开发和发布；这里使用 submodule，不是 subtree 或 worktree。

现有检出已采用标准子模块布局：子仓工作目录里的 `.git` 是指向主仓
`.git/modules/` 中对应 Git 目录的文件。不要只搬走某个子目录并假定它仍是完整
独立检出；需要另一份独立工作区时，直接克隆对应子仓。

`.gitignore` 只允许这三个 `repos/` 路径进入主仓索引，其余本地 checkout 仍忽略。
主仓跟踪三个 `160000` 模式的 gitlink，不跟踪子仓源码、依赖目录或构建产物。

## 克隆与同步

首次克隆（主仓远端需已包含子模块关联提交）：

```sh
git clone --recurse-submodules https://github.com/Ling0925/forge.git
cd forge
git submodule status --recursive
```

已有主仓检出，在取得包含 `.gitmodules` 和子模块指针的主仓提交后执行：

```sh
git submodule sync --recursive
git submodule update --init --recursive
```

普通 `git clone` 不会自动下载子仓内容，上述初始化命令可以补齐。
以后更新前先检查主仓及子仓工作区，保留或提交自己的改动；不要用强制更新覆盖它们。
在适合快进的干净工作区中，可依次执行：

```sh
git pull --ff-only
git submodule sync --recursive
git submodule update --init --recursive
```

`update --init --recursive` 检出主仓固定的版本；不要为了日常同步改成
`update --remote`，后者会选择远端分支版本，可能使主仓固定的版本组合发生变化。

## 在子仓开发与更新主仓指针

新初始化的子模块通常处于 detached HEAD，这是固定版本检出的正常状态。
在子仓里开始开发前，从当前版本创建自己的分支，例如：

```sh
git -C repos/forge-core switch -c feat/example-change
```

1. 在涉及的子仓修改、聚焦验证并提交，只暂存该子仓自己的文件。
2. 将子仓提交推送到它的远端分支，确保其他人能获取主仓将要引用的提交。
3. 返回主仓，审阅版本差异，只更新本次涉及的子模块指针。例如 Core 更新时：

```sh
git diff --submodule=log -- repos/forge-core
git add -- repos/forge-core
git diff --cached --submodule=log
git commit -m "chore: update forge-core submodule"
```

4. 明确需要推送主仓时，再执行 `git push --recurse-submodules=check`。
   这个检查用于发现子模块提交未推送的情况，不代替先推送子仓的步骤。

主仓的普通 `git commit` 不会把子仓里的未提交文件一起提交；反过来，子仓提交也
不会自动更新主仓里的指针。不要通过复制源码或强制推送来绕过这个分工。

## 包边界与构建

Core 提供 `@forge/core` 包，CLI/Web 通过声明的 `file:../forge-core` 本地包依赖
使用它，不复制核心和共享契约，不通过 `../../desktop-harness/src` 访问原库。
子模块保持同级目录，所以原有本地包依赖无需改变。
`@forge/core/shared/*` 是浏览器可用契约，其余 Node 实现不应进入浏览器包。
后续配置 registry 或 tarball 依赖时无需重新合并仓库。

先在 Core 安装并构建，再分别安装/构建 CLI 与 Web UI。精确入口和聚焦检查见
各仓的 `README.md`。Core 修改后重新构建，并重新安装消费者的本地文件包依赖。
主仓原有构建命令仍针对兼容源码，不会因加入子模块而自动构建三个子仓。

## 保留项与非目标

- 原库完整历史与旧 `src/` 暂时保留，供现有本机 CLI/桌面入口继续工作；主仓不是
  已经删去所有旧实现的纯装配仓，也不自动把旧源码修改同步到子仓。
- 原有 `src/renderer/components/workbench/ModelPicker.tsx` 与
  `src/renderer/styles/settings-models.css` 的未提交修改只留在原库，未混入子仓提交。
  后续需要时应人工审阅后迁入 Web UI 仓，不在子模块接入时覆盖它们。
- Electron 桌面壳与现有 Android WebView 工程仍留在主仓；它们不被冒充为 Web UI。
- 原库中的跨客户端集成测试保留。各子仓只承担自身职责的测试，拆分后迁移或
  尚未迁移的覆盖应以各仓文档和实际测试结果为准。
- 最初拆仓没有改变进程所有权；随后生产 Web 已改为显式连接独立 Core，见下节。
  CLI、桌面和旧开发入口仍可能各自创建核心。统一 daemon、Rust 内核、原生 Android
  是独立后续步骤；共享数据目录不代表共享运行时。
- 本机 `forge` 仍运行 `desktop-harness/dist/cli.mjs`，新 CLI 需要显式运行
  `repos/forge-cli` 的构建产物。本次没有安装、修改桌面入口或正式打包。

## 本机 Web / Core 独立进程

- Core：`repos/forge-core/dist/web/serve.js`，默认 API-only；会话、运行任务、审批、事件补发记录都留在此进程。
- Web：`repos/forge-web-ui/scripts/serve.mjs --core-url http://127.0.0.1:5175`，只服务 UI 和代理 HTTP/WebSocket，不创建运行时。
- 常驻服务使用两个独立 systemd 用户服务：`forge-core.service` 与 `forge-web.service`。
  更新 UI 后只执行 `systemctl --user restart forge-web.service`；不要重启 Core，也不要配置联动停止。
- Core 重启/主机重启仍会终止内存中的执行，不等于支持任意运行时热迁移。
- 发送附件单文件为 50 MiB；每会话合计仍为 64 MiB、128 个文件，图片输入和文本编辑限制不变。

构建顺序：Core `pnpm build` → Web `pnpm install --no-frozen-lockfile` → Web `pnpm build`。
本机 CLI 仍用兼容源码，本轮附件限制也同步到主仓，并按原短路径编译 CLI。

从本机旧 `forge-web-dev-lan.service` 迁移时，先在旧服务仍运行时检查：

```sh
node scripts/switch-split-web.mjs --host 192.168.8.108
# 确认访问地址、工作区、原 FORGE_HOME 正确，停止发起新任务后执行：
node scripts/switch-split-web.mjs --host 192.168.8.108 --apply --wait
```

默认保持 Web `192.168.8.108:5174`，Core 仅监听 `127.0.0.1:5175`，保留多工作区行为。
脚本无 `--apply` 时只查看 host 元数据；执行模式等待旧 Core 连续空闲 10 秒（最多 30 分钟），
拒绝替换未知入口、已有新服务或变化中的 host；不取消任务、不读取真实配置/密钥文件。
旧版没有原子 drain 接口，因此首次迁移的维护窗口请勿新发任务。原进程的运行态不能迁移，
若正在由 Web 对话执行升级，应把脚本放到独立 systemd 用户任务中，等当前回合结束后切换。
脚本切换后会实际重启一次 Web 并确认 Core PID/hostId 不变；失败保留现场，不自动重放迁移。
服务沿用原来的 transient 用户服务方式（不改桌面或 CLI 入口，不额外启用开机自启）。
状态与日志：`systemctl --user status forge-core forge-web`、`journalctl --user -u forge-web`。

## 拆分历史与已有验证记录

最初的路径提取基线为 `e089acbcf1c3fe10a71a9ce0fce5f9309305db3b`。
使用 `git-filter-repo 2.47.0` 在三个新建的非硬链接 clone 中按相关路径过滤历史，
保留作者和相关路径的提交记录；过滤后提交 ID 会变化，原仓历史没有重写。
三个仓库先以独立本地仓库建立，随后分别推送到 GitHub，再由主仓以子模块关联。
不要把过滤后的子仓历史直接推回主仓分支。

以下是**最初拆分时**的提交与验证，不是子模块接入后重新跑过的全量验收：

| 仓库 | 拆分提交 | 已验证 |
| --- | --- | --- |
| Core | `6d907f2` | 独立构建；14 个聚焦 Vitest 文件共 92 项通过；4 项构建包检查通过（浏览器契约、离线回合持久化、无 UI 的 API 启动等） |
| CLI | `4fe4d6e` | 独立构建、类型/包边界检查；64 项聚焦测试与 2 项真实产物烟测通过，production bootstrap 保持独立 |
| Web UI | `3c06a8c` | 独立构建；103 项聚焦单元/渲染/浏览器测试通过；真实生产入口的 Chromium 导航、CSP、RPC 与可选 socket 检查通过 |

- CLI 扩展测试为 791 通过、4 未通过：3 项需要外部 xterm Unicode11 QA 附件；
  1 项为 `ink-view` 的 24×8 dock 顺序断言，已在未拆分的原库同一用例上复现。
  拆分时没有改变旧窄屏布局或把失败静默跳过。
- Web UI 全量 typecheck/lint 尚未通过；CLI lint 也仍有诊断。没有逐条修复
  或完成全部错误的基线归因，不把构建或聚焦测试通过表述为“全量验收通过”。
- 启动/浏览器检查使用临时状态，不使用真实密钥，不调用真实 Provider；检查后
  服务和浏览器已关闭。没有做桌面/Android 构建或正式发布打包。

## 后续工作顺序

1. 在三个子仓中继续开发，由主仓固定并维护经过验证的版本组合。
2. 单独设计语言无关协议、daemon 单实例所有权与完整 CLI 客户端接入。
3. 在 Core 仓进行 Rust/Linux/Android 原型与行为对照迁移，不重写 UI 仓。

主仓只提交必要的装配配置、文档和子模块指针；子仓分别提交自身源码与构建调整。
真实配置、运行状态、依赖目录与构建产物均不应进入任何仓库提交。
