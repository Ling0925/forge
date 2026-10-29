# Forge

主仓只装配五个独立模块。**改功能请进入对应子模块，不要在根目录创建第二套源码。**

| 要修改什么 | 唯一源码位置 |
| --- | --- |
| 运行时、Provider、工具、存储、HTTP/WebSocket API | [repos/forge-core](repos/forge-core/README.md) |
| 命令行、TUI、终端渲染 | [repos/forge-cli](repos/forge-cli/README.md) |
| React 页面、组件、样式 | [repos/forge-web-ui](repos/forge-web-ui/README.md) |
| Android 原生 Compose / 兼容 WebView | [android](android/README.md) |
| Electron 桌面壳、macOS 打包 | [repos/forge-desktop](repos/forge-desktop/README.md) |

五个目录都是 Git 子模块，各自提交代码；主仓仅固定版本与维护入口。
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
Web 重启不终止 Core 任务；Core 更新需要单独重启，操作前先结束其活动任务。

## macOS 桌面版

在 Apple Silicon Mac 上显式构建，不影响日常 CLI/Web 开发：

```sh
pnpm setup:desktop
pnpm package:mac
```

产物在 `repos/forge-desktop/release/`。当前为 arm64、固定本地证书签名的自用版，
构建机须持有对应签名钥匙串；不会退回 ad-hoc，未做 Apple 公证。
签名准备、构建、启动与真实应用验收步骤见 [Desktop README](repos/forge-desktop/README.md)。

## 文档入口

- [模块更新、命令边界与旧代码恢复](docs/REPOSITORY_SPLIT.md)
- [开发代理约定](AGENTS.md)
- [Core 架构](repos/forge-core/docs/ARCHITECTURE.md) · [Core 专题导航](repos/forge-core/README.md#深入阅读)
- [CLI 使用指南](repos/forge-cli/docs/README.md)
- [Web 开发](repos/forge-web-ui/docs/WEB_DEV.md) · [界面约定](repos/forge-web-ui/docs/WEB_UI_LAYOUT_SPEC.md)
- [Android 构建](android/docs/BUILD.md) · [离线联调](android/docs/NATIVE_FIXTURE.md)

旧单体只作归档恢复，不参与当前构建；现行桌面壳在独立 Desktop 子仓维护。当前用法以各模块 README 和专题文档为准。
