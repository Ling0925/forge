<div align="center">

<img src="assets/brand/forge-icon-v3.png" width="128" height="128" alt="Forge 锻造图标" />

# Forge

**本地编码与任务代理 · Web 工作台、Linux 桌面与 Node 22 CLI**

[![Node Version](https://img.shields.io/badge/Node-%3E%3D22.23.1%20%3C23-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Linux%20x64-FCC624?style=flat-square&logo=linux&logoColor=black)](docs/DELIVERY.md)
[![Desktop Engine](https://img.shields.io/badge/Desktop-Electron%2044%20%2B%20React%2019-47848F?style=flat-square&logo=electron&logoColor=white)](package.json)
[![Original Architecture](https://img.shields.io/badge/Architecture-Original%20Harness-55684D?style=flat-square)](docs/AUTHORSHIP.md)
[![License](https://img.shields.io/badge/License-Internal%20%2F%20Proprietary-lightgrey?style=flat-square)](#)

<p align="center">
  <a href="#-核心特性">核心特性</a> •
  <a href="#-系统架构">系统架构</a> •
  <a href="#-安装与开始">安装与开始</a> •
  <a href="#-权限与安全模型">权限与安全模型</a> •
  <a href="#-工作流与命令速查">工作流与速查</a> •
  <a href="#-文档导航">文档导航</a>
</p>

</div>

---

> 💡 **原创声明与设计定位**  
> Forge 使用原创共享代理运行时。部分模型接入协议、预设及账号/路由算法依据 **Magpie 的 MIT 许可源码改编为 TypeScript**；不是 Go 网关或外部 CLI 包装（[来源与许可](THIRD_PARTY_NOTICES.md)、[实现及验证边界](docs/MODEL_ACCESS_PORT_STATUS.md)）。
>
> 无论是终端 CLI 还是 Linux 桌面工作台，均由**同一套核心运行时**驱动，共享状态模型、工具管道、会话存储与文件安全检查点。**Forge 不是云托管代理，也不是 OS 沙箱**，用户对本地文件、命令调用及模型交互拥有完全的可见性与审查权。

---

## ✨ 核心特性

| 特性 | 描述 |
| :--- | :--- |
| 🖥️ ↔️ 💻 **双端一体，共享核心** | 桌面端与终端 CLI 共享同一运行时、配置与持久化存储。桌面创建的会话可随时在终端通过 `forge resume <uuid>` 接续，反之亦然。 |
| 🛡️ **分级权限与交互审批** | 提供 `readonly`、`workspace`、`unrestricted` 三级权限模式。拒绝黑盒盲跑，命令执行与文件改动支持逐项用户审查。 |
| ⏪ **直接文件检查点 (Checkpoint)** | 对代理的每次直接文件写入与编辑（`write_file` / `append_file` / `edit_file`）生成安全快照，支持单文件差异核对与带冲突保护的回滚。 |
| 🤖 **受限多代理协作 (Sub-Agents)** | 原生提供 `spawn_agent` 工具，支持最大深度 1、并发 ≤4 的独立子任务调度；子代理**严格继承父级权限上限**，失败优雅收敛。 |
| 🔌 **原生 Git 工具与 stdio MCP** | 内置 10 个本地文件/系统工具及 3 个原生只读 Git 观测工具（`git_status` / `git_diff` / `git_log`）；支持基于标准 stdio 的 MCP 工具扩展。 |
| 📎 **对话文件交付** | 模型通过 `publish_file` 发送不可变会话附件，支持安全预览、Web 下载、桌面另存为和 CLI 保存；[使用与边界](docs/PUBLISHED_FILES.md)。 |
| 🧠 **SQLite 长期记忆** | 标签、摘要和详情的增删改查；`forge_memory` 从跨会话历史及已有记忆检索材料，再由当前模型熔炼并事务入库，支持预览和来源追溯；[使用说明](docs/memory.md)。 |
| 🎯 **动态精确模型发现** | `list_models` 保留供应商精确 ID，支持筛选、分页、持久目录缓存和显式刷新；目录不代表即时额度或可用性。 |
| 🎨 **Warm Light-First 工作台** | 桌面端采用温暖浅色优先的美学语法，去边框化、横向静默工具行（Quiet Tool Rows）与一体化圆润输入舱，打造沉稳专注的交互体验。 |

---

## 🏛️ 系统架构

```
                     ┌──────────────────────────────────────────────┐
                     │              用户操作界面 (Entrypoints)          │
                     ├──────────────────────┬───────────────────────┤
                     │   🖥️  Linux 桌面端    │     💻  终端 CLI      │
                     │  (Electron 44 / React)│    (Node 22 Commander)│
                     └──────────┬───────────┴───────────┬───────────┘
                                │                       │
                                └───────────┬───────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           Forge 共享代理运行时 (Shared Core)                         │
├────────────────────────────────┬──────────────────────────────────────────────────┤
│  🧭 模式控制                    │  🔄 会话生命周期                                  │
│  • Plan Mode (强制只读规划)     │  • 任务状态机 & 事件总线                           │
│  • Build Mode (标准构建执行)    │  • 语义压缩 (/compact) & 分支衍生 (/fork)         │
├────────────────────────────────┼──────────────────────────────────────────────────┤
│  🛡️ 权限与安全策略引擎         │  💾 持久化状态与快照                              │
│  • Readonly / Workspace / Unres│  • 会话文件存储 (~/.local/share/forge-harness)   │
│  • 交互式审批流 (Per-call)     │  • 文件级 Checkpoint 存储与冲突保护               │
├────────────────────────────────┴──────────────────────────────────────────────────┤
│                              ⚙️ 原生工具箱 (Tooling Bus)                          │
│  ┌──────────────────────┬──────────────────────┬───────────────────────────────┐  │
│  │  📁 文件与系统工具    │  🔍 原生 Git 观察    │  🧩 扩展协议 & 子代理         │  │
│  │  • read_file         │  • git_status        │  • stdio MCP Client           │  │
│  │  • write_file / edit │  • git_diff          │  • spawn_agent (depth 1, ≤4) │  │
│  │  • run_command       │  • git_log           │  • browser_tools (Playwright) │  │
│  └──────────────────────┴──────────────────────┴───────────────────────────────┘  │
└───────────────────────────────────────────┬───────────────────────────────────────┘
                                            ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                          模型服务适配层 (Provider Adapters)                        │
│            • OpenAI Chat Completions 协议  • OpenAI Responses 协议                 │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 安装与开始

### 环境依赖

- **操作系统**：**仅支持 Linux x64**。
- **CLI 运行环境**：系统需安装 Node.js `>=22.23.1 <23`。
- **桌面工作台**：发布包内已内置 Electron 44，无需额外单独安装。
- **浏览器扩展工具（可选）**：需要本机已安装匹配的 Chromium 与图形依赖（二进制不随安装包分发）。

> 📦 **发布包安装与校验**：详细打包规范、安装路径及回滚机制见 **[docs/DELIVERY.md](docs/DELIVERY.md)**。  
> 标准安装路径位于 `~/.local/share/forge-harness/releases/<build-id>/`。

### 快速配置与运行

```sh
# 1. 查看当前设置（脱敏显示）
forge config show

# 2. 设置兼容 Provider 的 Endpoint 与模型名称
forge config set --base-url https://example.invalid/v1 --model example-model

# 3. 安全注入 API 密钥（经 stdin 传入，避免泄漏到 argv / 历史记录）
printf '%s' "$MY_PROVIDER_KEY" | forge config set --api-key-stdin

# 4. 查询当前 Endpoint 支持的模型列表
forge models

# 5. 执行只读分析任务（适合代码审阅或项目摸底）
forge run '请梳理本项目的目录结构与入口文件' --workspace /absolute/path/to/project --permission readonly

# 6. 执行交互式构建任务（默认 build 模式）
forge run '修复 tests/math.test.ts 中失败的单测用例' --workspace /absolute/path/to/project --permission workspace

# 7. 查看历史会话并恢复交互
forge sessions
forge resume <session-uuid>
```

### 多来源与账号管理

`forge providers --help` 提供预设、来源、目录、显式连通/推理测试、Magpie 导入、Codex/Copilot 登录和额度查询；`forge routes --help` 管理显式路由组。工作台设置中提供对应入口。旧 `config` / `models` 命令继续可用。

四种协议为 Chat Completions、Responses、Anthropic Messages 和原生 Gemini。云鉴权、真实账号验证、迁移/回退及尚未移植的平台见 [接入状态与用法](docs/MODEL_ACCESS_PORT_STATUS.md)；目录存在不代表账号可调用。只有显式选择路由组才允许跨模型切换。

### 源码开发（主仓 + 三个子模块）

本仓库作为主仓（superproject），通过 Git submodule 固定三个独立仓库的版本：

| 子模块路径 | GitHub 仓库 | 职责 |
| :--- | :--- | :--- |
| `repos/forge-core` | `Ling0925/forge-core` | 核心运行时、共享契约与服务端 API |
| `repos/forge-cli` | `Ling0925/forge-cli` | 命令行、TUI 与终端渲染 |
| `repos/forge-web-ui` | `Ling0925/forge-web-ui` | React 界面、Web 构建与启动装配 |

主仓记录 `.gitmodules` 与各子仓的提交指针，不把子仓源码复制回主仓历史。主仓和三个
子仓均为公开仓库，可通过 HTTPS 克隆；推送仍需对应仓库的写权限。

```sh
# 首次克隆（远端主仓须已包含子模块关联提交）
git clone --recurse-submodules https://github.com/Ling0925/forge.git
cd forge

# 已有主仓：在取得包含关联配置的提交后，初始化或同步到主仓固定版本
git submodule sync --recursive
git submodule update --init --recursive
```

新 Core、CLI、Web UI 开发在各自子仓进行；先构建 Core，再按各仓 README 安装和构建
CLI/Web。三者保持同级，兼容现有 `file:../forge-core` 依赖。更新主仓版本组合时，
**先提交并推送子仓，再在主仓提交对应的 `repos/...` 指针**；主仓的普通提交不会提交
子仓里的文件。完整检出、更新和 detached HEAD 说明见 [仓库组织指南](docs/REPOSITORY_SPLIT.md)。

#### 兼容期：原仓本机 CLI

原 `src/`、桌面壳和构建脚本暂时保留，不与子模块自动同步；本机 `forge` 仍使用这些
兼容源码的产物，尚未切换到新 CLI。其开发流程仍是：**改代码 → 编译 CLI → 重开 `forge`**。
首次检出或依赖变更时执行 `pnpm install`，修改兼容 CLI 或共享核心后，在主仓根目录执行：

```sh
node scripts/build-core.mjs
```

当前这台机器的 `~/.local/bin/forge` 直接运行 `/home/ling/services/desktop-harness/dist/cli.mjs`；编译成功后，下次启动加载新产物，已运行的进程不会热更新，无需重新安装。此入口是本机配置，其他机器应先检查自己的启动器；也可直接运行 `node dist/cli.mjs`。

只改文档无需编译。代码改动按涉及的功能做聚焦检查；全量测试、类型检查和桌面打包不是本机 CLI 更新的前置步骤。验证启动时使用临时 `FORGE_HOME`，避免读取真实配置或改动会话：

```sh
node --check dist/cli.mjs
(
  forge_check_home=$(mktemp -d) || exit 1
  trap 'rm -rf -- "$forge_check_home"' EXIT
  FORGE_HOME="$forge_check_home" node dist/cli.mjs --help
)
```

其他开发入口按需要使用：

| 任务 | 命令与说明 |
| :--- | :--- |
| Web 界面开发 | `pnpm dev:web`；默认监听 `127.0.0.1:5173`，详见 [Web 开发工作台](docs/WEB_DEV.md) |
| Electron 开发 | `pnpm dev`；执行完整构建后启动 Electron |
| 完整构建 | `pnpm build`；重新生成 CLI、桌面宿主和渲染端产物 |
| 聚焦测试 | `pnpm exec vitest run tests/cli/markdown-bundle.test.ts`；按改动选择对应测试文件 |
| 全量检查 | 按任务需要运行 `pnpm test`、`pnpm typecheck`、`pnpm lint` |
| 发布与安装 | 仅在需要分发时按 [交付指南](docs/DELIVERY.md) 执行 |

### 项目目录

`repos/` 是新的独立组件源码；根目录 `src/` 暂为兼容现有入口保留，不自动同步子仓。

| 路径 | 职责 |
| :--- | :--- |
| `.gitmodules`、`repos/` | 三个子模块的地址与固定提交；协同方式见 [仓库组织指南](docs/REPOSITORY_SPLIT.md) |
| `src/core/`、`src/store/` | 兼容源码：共享代理运行时、会话与设置持久化 |
| `src/provider/`、`src/tools/`、`src/mcp/`、`src/context/` | 模型协议、工具执行、MCP、项目指令与技能发现 |
| `src/cli/` | CLI 入口与 Ink 终端交互 |
| `src/desktop/`、`src/renderer/`、`src/web/` | Electron 宿主、共享 React 界面、Web 开发宿主 |
| `src/shared/` | 跨入口类型、协议、校验与共享逻辑 |
| `tests/` | 按模块组织的测试与 fixture |
| `scripts/` | 构建、开发、验证和显式维护脚本；历史探针见 [QA 归档](scripts/archive/sidebar/README.md) |
| `docs/` | [分类文档索引](docs/README.md)，区分使用说明、需求与历史记录 |
| `examples/`、`website/`、`patches/` | 示例、独立网页资源与依赖补丁 |
| `dist/`、`release/`、`.build/` | 构建产物、发布产物与本地开发证据，均由 Git 忽略 |

---

## 🔒 权限与安全模型

Forge 秉持**零黑盒、强可见、诚实报告**的设计准则：

### 权限等级概览

| 模式 | 描述 | 本地文件读 | 本地文件写 | 命令执行 | 适用场景 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `readonly` | **纯只读模式** | ✅ | ❌ | ❌ | 代码审阅、架构分析、排查定位 |
| `workspace` | **工作区约束模式** *(推荐)* | ✅ | ✅ *(仅工作区内)* | ⚠️ *(高危动作逐项审批)* | 常规功能开发与本地编码重构 |
| `unrestricted` | **完全放宽策略** | ✅ | ✅ | ⚠️ *(除非指定 `--yes` 否则仍交互审批)* | 自动化批处理脚本、受信任环境 |

### ⚠️ 使用边界与安全声明（诚实说明）

1. **非操作系统沙箱**：`run_command` 不是 OS 级容器沙箱。一旦批准命令执行，该进程以宿主当前用户权限运行，具有访问工作区之外网络与文件的能力。
2. **Checkpoint 保护范围**：Checkpoint 快照**仅自动覆盖由 `write_file`、`append_file` 和 `edit_file` 发起的直接文件变动**，不捕获 `run_command` 生成的副作用（如 `git reset`、编译器输出或脚本执行产生的改动）。
3. **MCP 连接**：支持 stdio、Streamable HTTP 和旧版 SSE。注册本身不连接；CLI 注册默认启用，可加 `--disabled`。调用沿用当前权限策略，无限制模式不额外确认。远程鉴权可配置私有请求头，尚无 OAuth 登录流程。
4. **浏览器运行时需外部提供**：浏览器工具依赖 Playwright 与外部 Chromium 实例，必须在配置中严格指定具体的 Origin 白名单（不允许通配符）。
5. **真实指标保证**：仅当服务端在协议中返回可观测的真实 Token 统计与缓存指标时，工作台才如实展示；绝不推断、伪造或估计缓存命中率。

---

## ⌨️ 工作流与命令速查

### CLI 常用操作

```sh
# ------------------------------
# 模式与运行
# ------------------------------
forge run --mode plan "审查鉴权逻辑并拟定重构方案" --workspace . --permission readonly  # 强制只读规划
forge run --mode build "执行重构并验证单测" --workspace . --permission workspace          # 执行构建模式

# ------------------------------
# 会话控制与语义压缩
# ------------------------------
forge sessions                                     # 查看会话列表与状态
forge resume <session-uuid>                        # 恢复并继续已有会话
forge fork <session-uuid>                          # 分支克隆当前历史（不重放副作用）
forge compact <session-uuid>                       # 生成语义紧凑摘要，减少上下文消耗

# ------------------------------
# MCP 工具管理
# ------------------------------
forge mcp list                                     # 查看已注册的 MCP 服务
forge mcp register local "Local" node /path/to/server.mjs
forge mcp register-remote remote "Remote" https://example.com/mcp
forge mcp enable local                            # 启用之前禁用的服务
forge hooks set /path/to/hooks.json                # 按需配置生命周期脚本
forge hooks clear                                 # 移除 hook 配置
```

### 快捷交互（交互会话中）

子代理可通过 `spawn_agent` 的 `isolation: "worktree"` 在独立 Git 工作树中修改文件，默认仍共享工作区。详见 [工作树隔离](docs/AGENT_WORKTREES.md)、[生命周期 hooks](docs/TOOL_HOOKS.md) 和 [MCP](docs/MCP.md)。

- `/plan` / `/build`：实时切换规划与构建模式。
- `/compact`：触发当前会话历史的语义压缩。
- `/fork`：以当前上下文为基础分裂出全新分支。
- `Ctrl + C` 或取消按钮：即时取消活动模型调用与正在执行的子任务。

---

## 📚 文档导航

完整清单见 **[分类文档索引](docs/README.md)**；需求与历史验收记录的适用范围也在索引中说明。常用入口如下：

| 文档分类 | 关键文档 | 主要内容 |
| :--- | :--- | :--- |
| **🚀 进阶工作流** | **[docs/WORKFLOWS.md](docs/WORKFLOWS.md)** | 端到端全流程运行示例、桌面与终端联动实战 |
| **💻 命令行参考** | **[docs/CLI.md](docs/CLI.md)** | 完整命令、参数标志、输入流及环境变量定义 |
| **Web 开发** | **[docs/WEB_DEV.md](docs/WEB_DEV.md)** | 启动、热更新、宿主差异与聚焦验证 |
| **Android / 局域网** | **[docs/ANDROID.md](docs/ANDROID.md)** | 桌面/Web 核心公开、手机扫码连接与 Android 构建 |
| **🏛️ 架构与设计** | **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**<br>**[DESIGN.md](DESIGN.md)** | 核心运行时架构分解、桌面端视觉语素与交互规范 |
| **🌐 模型与协议** | **[docs/PROVIDERS.md](docs/PROVIDERS.md)** | OpenAI / Anthropic SDK、三种协议与续传语义 |
| **🧩 扩展与集成** | **[docs/CONTEXT.md](docs/CONTEXT.md)**<br>**[docs/MCP.md](docs/MCP.md)**<br>**[docs/BROWSER_TOOLS.md](docs/BROWSER_TOOLS.md)** | 项目指令 (AGENTS.md) 与技能包发现、stdio MCP 服务、Playwright 浏览器工具 |
| **📦 发布与交付** | **[docs/DELIVERY.md](docs/DELIVERY.md)** | Linux 打包产物结构、发布流水线、安装核验与回滚步骤 |
| **⚖️ 设计溯源** | **[docs/AUTHORSHIP.md](docs/AUTHORSHIP.md)**<br>**[docs/REFERENCE_DESIGN.md](docs/REFERENCE_DESIGN.md)** | 原创性界定、参考调研来源与版权边界声明 |

---

<div align="center">

Forge · Built for engineers demanding full local control, transparency, and crafted ergonomics.

</div>
