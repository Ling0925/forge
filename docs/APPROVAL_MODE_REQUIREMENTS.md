# Forge 命令审核模式（Full access / Auto / Manual）需求

本文是**命令审核模式**的需求文档，覆盖 CLI 与非交互入口的审批行为。
它描述目标模型、现行实现、与既有安全契约的冲突点及验收标准，**不是**已通过验收的声明。

- 相关契约：[CLI.md](CLI.md)（终端交互与审批）、[ARCHITECTURE.md](ARCHITECTURE.md)（审批与权限）、[WORKFLOWS.md](WORKFLOWS.md)、[BROWSER_TOOLS.md](BROWSER_TOOLS.md)。
- 术语：**审核模式**指"命令执行前是否需要人工批准"的策略。它**区别于** 运行模式 `mode`（`build`/`plan`）与权限 `permission`（`readonly`/`workspace`/`unrestricted`）。

## 0 重要前置声明（必读）

> **本需求要求把默认值从"审批默认拒绝"改为"默认完全放行"，这会反转本项目已明确记载的安全默认。**

现有权威约定：

- `docs/CLI.md`：**"审批默认拒绝。"**（approval defaults to deny）
- `ARCHITECTURE.md`：默认权限 `readonly`；`workspace` 对高风险操作**必须请求审批**。
- `src/shared/schemas.ts:117`：`defaultPermission: "workspace"`。
- 现有 CLI 的 `auto` 是**显式 opt-in**（`--approval auto` 或 `/approval auto`），且**仅限本会话**，默认始终是 `ask`（`src/cli/cli.ts:283`）。
- `COMMAND_APPROVAL_WARNING`（`src/cli/approval-policy.ts:12`）明确警告：命令**不是沙箱**，可访问工作区外文件与网络。

因此本需求的落地**必须**：

1. 由需求方**显式确认**接受"默认全放行"的风险（见 §7 待决问题 Q0）。
2. 不改动底层"非沙箱"事实：`full access` 只是**跳过审批**，**不等于** OS 沙箱或隔离。
3. 保留可审计性：默认放行时仍须**记录**被自动批准的命令，而非静默执行。

若需求方不接受上述第 1 条，本需求应降级为"默认 `auto`（仅 `run_command`）"而非"默认 full access"。

## 1 需求摘要

1. 引入**三态审核模式**：`full access`、`auto`、`manual`。
2. **默认值为 `full access`**（与现状相反，见 §0）。
3. 用户可**手动切换**到 `auto` 或 `manual`，切换即时生效并可见。
4. 依据："模型能力已足够，无需逐次人工确认"——这是**需求方的主观判断**，非可验证结论，本文不做背书。

## 2 现状（经代码核对）

| 项 | 现状 | 位置 |
| --- | --- | --- |
| 现有审核模式 | 仅两态：`"ask" \| "auto"` | `src/cli/approval-policy.ts:4` |
| 默认值 | `ask`（`--approval` 缺省时为 `"ask"`） | `src/cli/cli.ts:283` |
| 切换方式 | `/approval ask\|auto`（**仅本会话**） | `src/cli/interactive.ts:178-184` |
| 自动批准范围 | 仅 `run_command`，且仅 `workspace`/`unrestricted` 权限，且非子会话 | `src/cli/approval-policy.ts:15-27` |
| 子代理 | **从不**自动批准（`!request.childSessionId`） | `approval-policy.ts:24` |
| MCP/浏览器/文件工具 | **从不**自动批准 | `tests/cli/approval-policy.test.ts:87-100` |
| 桌面端 | **无 auto 概念**；审批全部经 UI 手动回答 | `src/desktop/controller.ts`、`answerApproval` |
| 会话重置 | 切换会话时 `approvalMode` 复位为 `ask` | `src/cli/interactive.ts:141` |

关键结论：**当前不存在 "full access" 概念，桌面端也不存在任何自动批准**。本需求是新增一套三态模型，并改变默认值。

## 3 目标

1. 三态审核模式语义清晰、互斥、可切换。
2. 切换有即时、可见、可审计的反馈。
3. 与既有 `permission` / `mode` 的关系明确（不得出现三套概念互相矛盾）。

## 4 非目标

- 不把 `full access` 表述为"安全"或"沙箱"。
- 不取消审批的**记录**能力（默认可放行，但不可无声）。
- 不改变 plan 模式的强制只读：`mode === "plan"` 时仍钳制为只读，**审核模式不能越过它**。
- 不改变子代理的权限上限继承规则。
- 不改变"粘贴/预输入不构成授权"的语义（对仍需审批的场景）。

## 5 功能需求

### 5.1 三态语义（R-S 系列）

| 模式 | 语义（建议定义） | 需确认 |
| --- | --- | --- |
| **`full access`** | 所有工具调用**一律自动批准**，含 `run_command`、MCP、浏览器、文件写；不弹审批 | 是否含 MCP/浏览器？见 Q1 |
| **`auto`** | 仅**符合条件**的调用自动批准，其余仍请求人工审批。默认沿用现有 `shouldAutoApprove` 范围（仅 `run_command`） | 是否扩大范围？见 Q1 |
| **`manual`** | 全部请求人工审批；等价于现有 `ask` | — |

- **R-S1**：三态互斥；任一时刻只有一个生效。
- **R-S2**：`full access` **必须**受 `permission` 与 `mode` 约束：
  - `mode === "plan"` → 仍强制只读，`full access` 不得放行写操作。
  - `permission === "readonly"` → 仍拒绝写/执行。
  即 **`full access` 只消除"审批步骤"，不提升权限本身**。
- **R-S3**：`full access` 下子代理的自动批准规则需明确（当前子会话**从不**自动批准）。见 Q1。
- **R-S4**：`manual` 的"默认拒绝 + 需新输入 `y`"语义保持不变。

### 5.2 默认值与切换（R-D 系列）

- **R-D1**：默认审核模式为 `full access`（**与现状相反**，见 §0）。
- **R-D2**：可手动切换到 `auto` / `manual`，**即时生效**。
- **R-D3**：切换命令与现有 `/approval` 保持一致（扩展取值），并提供 `--approval full-access|auto|manual` CLI 标志。
- **R-D4**：启动进入 `full access` 时**必须**打印一次显著警告（说明非沙箱 + 将自动放行）。
- **R-D5**：切换时必须用**非颜色**方式回显当前模式（文字），并说明作用域（会话级？持久化？见 Q2）。
- **R-D6**：桌面端需决定是否同步支持三态（当前桌面无 auto，见 Q3）。

### 5.3 可审计性（R-L 系列，强制）

- **R-L1**：`full access`/`auto` 自动批准时，**必须**记录被放行的工具与 argv（复用现有回显：`Auto-approved …`）。
- **R-L2**：记录不得包含密钥/敏感值（沿用既有 redaction）。
- **R-L3**：至少保留一条终态汇总（本次运行自动放行了 N 条命令），供事后核查。

## 6 安全与边界约束（强制）

- **R-X1**：文档与 UI 必须继续声明**"命令不是 OS 沙箱"**；不得暗示 `full access` 提供隔离。
- **R-X2**：默认放行属于**默认放宽**，实现需与 `ARCHITECTURE.md`、`CLI.md` 的安全默认描述一致化更新（**否则文档与代码矛盾**）。
- **R-X3**：不得因默认放行而移除审批**代码路径**；`manual`/`auto` 仍可完整使用。
- **R-X4**：非交互 `--yes` 与 `unrestricted` 的既有约束不得被静默绕过（`docs/CLI.md:58`）。
- **R-X5**：`mode === "plan"` 的强制只读优先级**高于**审核模式。

## 7 待决问题

- **Q0（阻塞）**：需求方是否**显式确认**接受"默认完全放行"的风险？若不确认，退化为默认 `auto`。
- **Q1**：`full access` 是否包含 **MCP 工具**与**浏览器工具**？`auto` 的范围是否从"仅 `run_command`"扩大？（影响 R-S1/S3）
- **Q2**：审核模式是**仅本会话**、还是**持久化**为设置默认？现状是仅本会话且切换会话即复位（`interactive.ts:141`）。
- **Q3**：桌面端是否同步支持三态？当前桌面**无任何**自动批准能力。
- **Q4**：`full access` 是否触发**一次性确认**（类似桌面 `unrestricted` 的确认门槛）？
- **Q5**：命名冲突：现有代码用 `"ask"`，本需求用 `"manual"`；是否重命名/别名？

## 8 验收标准

- **AC-1**：三态可切换，切换后行为与语义表一致。
- **AC-2**：默认为 `full access`，启动有显著警告。
- **AC-3**：`mode=plan` 或 `permission=readonly` 时，`full access` **不能**放行写/执行。
- **AC-4**：自动放行均有记录，且不含敏感值。
- **AC-5**：`manual` 的默认拒绝语义与现有测试保持一致（不回归）。
- **AC-6**：自动化测试：
  - 扩展 `tests/cli/approval-policy.test.ts` 覆盖 `full-access` 分支；
  - 覆盖 plan/readonly 的优先级；
  - 桌面若支持，补 mounted 测试。
- **AC-7**：`pnpm typecheck`、`pnpm test` 通过；文档（`CLI.md`/`ARCHITECTURE.md`）与代码同步更新。

## 9 风险与约束

- **最高风险：反转安全默认**。这是本需求与项目既有设计契约的**直接冲突**，必须由需求方知情确认，并在文档中显式记录这一变更。
- **语义膨胀风险**：项目已有 `mode`、`permission`、`approvalMode` 三个概念；再加三态审核易混淆，需在文档中给出**交互矩阵**。
- **测试回归**：现有 `tests/cli/approval-policy.test.ts` 假设默认 `ask`；默认值变更会导致相关断言与文档同步失效。
- **并发工作**：工作区存在其他任务的在途改动（Markdown 渲染相关），实现时不得覆盖。
- **本机流程**：按 AGENTS.md，本机 CLI 更新走"改代码 → `node scripts/build-core.mjs` → 重开 `forge`"，不做完整发布/打包。

## 10 未验证项（诚实说明）

- 本文现状均来自**源码核对**；未实测切换行为，未运行 CLI/桌面验收。
- "模型能力已足够"是**需求方的主观判断**，本文不将其作为可验证结论，也不做能力背书。
- `full access` 涉及的具体工具范围（MCP/浏览器/子代理）**未定**，见 Q1。
- 未评估默认放行对既有审计证据（`.omo/evidence`）与发布校验流程的影响。

## 11 实施状态（2026-10-14）

阻塞：Q0/Q1 尚待直接确认；本需求 manual 保持默认拒绝与 APPROVAL_DEFAULT_REQUIREMENTS 的空回车批准冲突。本轮保留 ask 默认与已有显式 auto 范围，不默认切到 full-access 或 auto，也不扩大 MCP/浏览器/子代理自动审批。已向用户询问默认策略及工具范围。既有审批回归测试通过不等于本三态需求验收。
