# Forge

Forge 是本地 Linux 桌面应用与 Node 22 CLI，共用**同一**代理运行时、设置和持久化会话。
可向自选的兼容接口发送任务，逐步查看模型回复与本地文件、命令、MCP 工具调用，并检查/恢复
文件 checkpoint。**不是云托管代理，也不是 OS 沙箱。**用户可以自行审查权限与外部服务。

> 原创说明：Forge 未导入、fork 或依赖任何既有 harness 源码；参考仅用于设计研究，见
> [docs/REFERENCE_DESIGN.md](docs/REFERENCE_DESIGN.md)。

## 安装与开始

- 平台：**仅 Linux x64**。
- CLI 需要系统安装 Node `>=22.23.1 <23`。
- 桌面包内含 Electron（构建时锁定为 Electron 44）；无需单独安装 Electron。
- 浏览器工具需要本机可用的 Chromium 与图形依赖；浏览器二进制**不随包分发**（见下）。

发布产物、校验与回滚步骤见 **[docs/DELIVERY.md](docs/DELIVERY.md)**。安装后目录形如
`~/.local/share/forge-harness/releases/<build-id>/`，其中 CLI 在 `cli/`、桌面在 `desktop/`；
`cli` 是 Node 脚本，**不是**独立二进制。文档随发布树一起分发，README 的相对 `docs/` 链接在抽包后仍可用。

安装后常用命令（把示例值替换为你**自行授权**的真实值）：

```sh
forge config show
forge config set --base-url https://example.invalid/v1 --model example-model
# 密钥只经标准输入，不进入 argv / 历史 / 文档：
printf '%s' "$MY_PROVIDER_KEY" | forge config set --api-key-stdin
forge models
forge run '请先列出项目文件' --workspace /absolute/path --permission readonly
forge sessions
forge resume <session-uuid> # 恢复交互会话
forge run --session <session-uuid> '继续处理' # 单次续跑
```

示例 URL 与模型均为占位符，请替换为你自行授权的真实配置。完整的端到端工作流、plan/build、
子代理、checkpoint、MCP 注册、桌面↔CLI 续跑与桌面界面使用速览见 **[docs/WORKFLOWS.md](docs/WORKFLOWS.md)**。

### 在源码检出中构建（仅开发）

以下命令**只适用于源码检出**，不出现在安装后的发布树里；发布树中的 `scripts/` 不存在。

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## 关键操作面

- **双入口共享会话**：桌面创建的会话可在 CLI 用其 UUID `forge resume` 继续，反之亦然。
- **plan/build**：`--mode plan` 强制只读；`--mode build`（默认）按权限执行。
- **子代理**：原生工具 `spawn_agent` 启动深度 1、并发≤4 的独立子会话，**继承权限上限**
  （永不超出父权限），可使用真实指定模型；子任务失败会进入父的收敛流程，父运行终态变为失败。
- **模型发现**：原生工具 `list_models` 只读地列出所配置 provider 目录中的**精确**模型 ID，
  支持子串过滤与分页；目录存在**不**代表实时配额或可用性。
- **语义摘要与分支**：`/compact` 与 `forge compact`、`/fork` 与 `forge fork` 生成语义摘要或
  仅复制历史，**不重放**被复制的副作用；可对活动运行发出取消（`cancel_agent` / 界面取消 / Ctrl-C）。
- **checkpoint**：对直接文件写入/编辑（`write_file`/`edit_file`）做可恢复备份，按单个文件、
  带冲突保护的恢复；`run_command` 副作用**不是** checkpoint。
- **stdio MCP**：注册现有示例 `examples/mcp/echo-server.mjs` 需**一次显式注册并启用**动作；
  仅 stdio，无远端/OAuth。
- **原生 git 工具**：`git_status`/`git_diff`/`git_log` 是已注册的只读本地工具（本地文件/命令
  工具共 10 个）；Git 观察**不是** checkpoint。

CLI 命令清单见 **[docs/CLI.md](docs/CLI.md)**；项目指令与技能见 **[docs/CONTEXT.md](docs/CONTEXT.md)**；
provider 协议与显式 Completions/Responses 见 **[docs/PROVIDERS.md](docs/PROVIDERS.md)**；
架构见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**；出处与作者边界见 **[docs/AUTHORSHIP.md](docs/AUTHORSHIP.md)**。

## 权限与安全

`readonly` 限制本地写入/执行（但读取和加载网页也可能有远程副作用）；`workspace` 将本地操作
约束于工作区并对高风险操作请求审批；`unrestricted` 放宽策略，**不是 OS 沙箱**。仅当明确同时
给出 `--permission unrestricted --yes` 时 CLI 才自动批准，否则按审批交互。工具结果与网页内容
均不可信。浏览器工具需可用的 Playwright Chromium 及运行时配置的**精确 origin**（无通配），
详见 [docs/BROWSER_TOOLS.md](docs/BROWSER_TOOLS.md)。

只有服务端返回**可观测**缓存用量时才展示真实指标；无命中数据时不得推断缓存命中。请求成本、
模型能力、Chromium/图形依赖与外部服务可用性是环境相关的。不要把真实 endpoint、密钥或用户数据
打进发布包。

## 使用边界（诚实说明）

- 仅 **Linux x64**；CLI 需要系统 Node 22；桌面包内含 Electron。
- **MCP 仅支持 stdio**：无远端 HTTP/SSE/OAuth。注册后默认禁用；需显式 `enable` 才可启动，
  per-call 仍需授权。
- **`run_command` 不是 OS 沙箱**：已批准命令可访问工作区之外或网络。
- **checkpoint 只覆盖直接文件写入/编辑**：不覆盖命令副作用，也不是目录级反转或 `git reset`。
- **浏览器二进制不随包分发**：需本机安装匹配版本的 Chromium，或通过
  `FORGE_BROWSER_EXECUTABLE` 指定兼容浏览器。

安装、校验与回滚的完整步骤见 **[docs/DELIVERY.md](docs/DELIVERY.md)**。发布负责人应在分发前
按该文档核验实际产物；分发前的最终核验状态以发布流程实际执行为准，本文档不替代该核验。
