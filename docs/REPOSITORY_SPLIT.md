# 五个模块，一个装配主仓

Forge 主仓只记录模块版本、提供开发入口和归档导航。应用实现不再保留在根目录。

| 模块 | 唯一源码位置 | 独立仓库 |
| --- | --- | --- |
| Core | `repos/forge-core` | [forge-core](https://github.com/Ling0925/forge-core) |
| CLI / TUI | `repos/forge-cli` | [forge-cli](https://github.com/Ling0925/forge-cli) |
| Web UI | `repos/forge-web-ui` | [forge-web-ui](https://github.com/Ling0925/forge-web-ui) |
| Android 原生 / WebView | `android` | [forge-android](https://github.com/Ling0925/forge-android) |
| Electron Desktop | `repos/forge-desktop` | [forge-desktop](https://github.com/Ling0925/forge-desktop) |

Android 保留原路径，Gradle、SDK 配置、构建产物、模拟器及离线 fixture 不需搬家。
它与其他模块一样由 gitlink 引用，源码和历史属于自己的仓库。

## 初始化和日常修改

```sh
git clone --recurse-submodules https://github.com/Ling0925/forge.git
cd forge
pnpm run setup
node scripts/build-core.mjs
```

已有检出先保存各仓改动，再用 `git submodule update --init --recursive` 取得主仓
固定的版本。不要在有其他任务改动时执行更新，不用 `--remote` 代替固定版本同步。

子模块初始化后可能处于 detached HEAD；修改前在目标子仓建分支，提交其源码与测试。
回到主仓只暂存本次需要更新的 gitlink。默认只本地提交；要推送主仓时，先确认它引用
的子仓提交已经可从远端取得，再用 `git push --recurse-submodules=check`。

五个子仓各自管理依赖、测试与构建。主仓不安装 Electron、React 或 Provider SDK，
也不再提供单体的 typecheck/lint/test/package。旧跨客户端测试完整留在归档中；
主仓的 `pnpm test` 只验证装配入口，不代表子模块全量测试。

## 本机 CLI 仍是编译后重开

```sh
node scripts/build-core.mjs
forge
```

构建顺序是 Core → CLI，输出的 `dist/cli.mjs` 仅导入
`repos/forge-cli/dist/cli.mjs`，保留 CLI 的 production bootstrap、参数和调用工作目录。
本机 `~/.local/bin/forge` 无需改写。运行中的 CLI 不会热更新。

CLI 的 `@forge/core` 是外部包；主仓装配将其 `node_modules/@forge/core` 链接到
`repos/forge-core`，避免 pnpm `file:` 副本仍使用旧实现。模块 manifest/锁文件不改动。
`pnpm run setup` 为三个 Node 模块安装各自锁定依赖并设置本地链接；之后日常 CLI 构建
不需要重新安装。独立克隆子仓时仍按各自 README 使用 `file:../forge-core`。

`pnpm build:web` 只构建 Web UI，需要 Core 已构建；该命令也刷新 Web 的本地 Core
链接。正在运行 Vite 时不要同时切换它的依赖链接，准备更新时只重启 Web。
CLI 构建不改变 Web 的依赖链接，也不重启 Core 或 Web 服务。

## Web 和 Core 分开启动

```sh
# 终端 A：Core 持有任务；FORGE_HOME 指定数据目录。
pnpm serve:core -- --host 127.0.0.1 --port 5175 --workspace /absolute/project --multi-workspace
# 终端 B：Web 开发热更新，不创建第二个 Core。
pnpm dev:web -- --host 127.0.0.1 --port 5173 --core-url http://127.0.0.1:5175
# 静态 Web 则先 pnpm build:web，再替换终端 B：
pnpm serve:web -- --host 127.0.0.1 --port 5173 --core-url http://127.0.0.1:5175
```

旧的 `dev:web --workspace` 单体语义已退出；工作区和运行状态现在由独立 Core 管理，
Web 的 `--core-url` 必填。旧参数会报错，不会偷偷回退到旧实现。
React/CSS 在 Web 子仓热更新；重启 Web 不终止 Core 任务。
Core 更新后只有显式重启才加载新产物，重启前须结束其活动任务。

## 独立桌面壳与 macOS 构建

`pnpm setup:desktop` 只安装 Core/Web/Desktop 的依赖；普通 `pnpm setup` 不安装 Electron。
`pnpm build:desktop` 按 Core → Web → Desktop 装配，不重写 CLI 启动器。
在 Apple Silicon Mac 上 `pnpm package:mac` 生成 arm64 DMG；默认不发布、不安装、
不覆盖旧桌面入口。当前包使用固定本地证书，构建机须持有对应专用钥匙串；
证书或组件身份不匹配时打包失败，不回退到 ad-hoc。此本地自签名包未经 Apple 公证。

Desktop 内只有窗口/进程生命周期和打包：隔离 utilityProcess 运行当前 Core，
渲染器用当前 Web 的 HTTP/WebSocket 桥。依赖版本与验证方法见
[Desktop README](../repos/forge-desktop/README.md)。

## 旧代码和未提交修改在哪里

- 归档分支：`codex/archive-monolith-20261023`。
- 不变的归档基线：`a568d4568ebe73057e8ef002c29117179b05bbef`。
- 本机原工作副本：`.archive/legacy-20261023/worktree/`，已被 Git 忽略，不作为开发源码。
- 两处原有未提交 Web 修改保存在上述 `worktree/src/renderer/` 中；另有
  `.archive/legacy-20261023/local-renderer.patch`。它们没有混入归档提交或 Web 子仓。

根目录旧 `src`、应用测试、设计文档、示例、品牌原稿、参考 checkout、旧构建/发布
脚本和依赖配置均已移入本机归档。旧 Electron 实现留在归档，已有发布包与启动器保留。
现行桌面壳单独维护于第五个子模块 `repos/forge-desktop`，通过当前 Core/Web 构建，
不恢复旧单体。Android 继续维护，不属于停用的旧代码。

查看旧文件用 `git show codex/archive-monolith-20261023:src/...`。需要完整恢复旧
单体源码时导出到另一个目录，不要把第二套实现恢复到当前开发根目录：

```sh
mkdir -p /tmp/forge-legacy
git archive codex/archive-monolith-20261023 | tar -x -C /tmp/forge-legacy
```

归档分支和 `.archive` 是本机恢复入口，不假定其他克隆有它们。归档基线是主仓历史
的一部分；取得完整历史后，可用上述提交 ID 替代分支名查询或导出。历史归档不包含
本机未提交补丁。真实配置、会话、附件、缓存、现有 release 和桌面产物不在归档中。

本机编译会使用子模块当前工作区，包括未提交源码。交付版本则由主仓 gitlink 决定；
更新指针前核对子仓提交范围，不能把其他任务已有的提交顺便纳入。
