# Forge

主仓只装配四个独立模块。**改功能请进入对应子模块，不要在根目录创建第二套源码。**

| 要修改什么 | 唯一源码位置 |
| --- | --- |
| 运行时、Provider、工具、存储、HTTP/WebSocket API | [repos/forge-core](repos/forge-core/README.md) |
| 命令行、TUI、终端渲染 | [repos/forge-cli](repos/forge-cli/README.md) |
| React 页面、组件、样式 | [repos/forge-web-ui](repos/forge-web-ui/README.md) |
| Android 原生 Compose / 兼容 WebView | [android](android/README.md) |

四个目录都是 Git 子模块，各自提交代码；主仓仅固定版本与维护入口。
Android 保留 `android/` 路径，现有 Gradle、SDK 和模拟器工作目录不用迁移。

## 本机开发

已有依赖时，CLI 仍用原来的短路径：

```sh
node scripts/build-core.mjs
forge
```

这会构建 Core 和 CLI，根目录 `dist/cli.mjs` 只转发到 CLI 子模块产物。
本机启动器不用重装；重开 `forge` 生效，已有进程不热更新。

首次克隆：

```sh
git clone --recurse-submodules https://github.com/Ling0925/forge.git
cd forge
pnpm run setup
node scripts/build-core.mjs
```

需要 Node 22.23.1+（22.x）和 pnpm 11.18.0；Android 的 JDK/SDK 要求见其 README。
主仓不安装应用依赖，各 Node 模块使用自己的锁文件。

## Web 开发

```sh
# 分别在两个终端运行。数据和工作区由 Core 管理。
pnpm serve:core -- --host 127.0.0.1 --port 5175 --workspace /absolute/project --multi-workspace
pnpm dev:web -- --host 127.0.0.1 --port 5173 --core-url http://127.0.0.1:5175
```

改 `repos/forge-web-ui/src/renderer` 会热更新。静态页面用 `pnpm build:web` 构建，
再用 `pnpm serve:web -- --core-url http://127.0.0.1:5175` 启动。
本机现有 Core/Web 服务仍直接使用子模块入口，本次不重启它们。

## 旧代码归档

旧单体代码、Electron 壳、旧测试和文档保存在
`codex/archive-monolith-20261023` 分支，基线
`a568d4568ebe73057e8ef002c29117179b05bbef`。

本机旧工作副本在已忽略的 `.archive/legacy-20261023/worktree/`。
两处原有未提交 Web 修改仍在那里，另有 `local-renderer.patch`；没有自动迁入 Web 子仓。
归档不参与构建、测试或日常源码搜索。现有桌面安装包、会话、配置和附件保留。

[模块更新、命令边界与恢复方法](docs/REPOSITORY_SPLIT.md)
