# Forge 写文件工具选择优化需求

本文是**工具选择（tool selection）**的优化需求文档：修正模型倾向用 `run_command` 调 node/python 创建/修改文件，而非用原生 `write_file`/`edit_file` 的问题。
它描述**已核对的根因证据**、优化方案、验收标准与验证方法，**不是**已通过验收的声明。

- 相关契约：[ARCHITECTURE.md](ARCHITECTURE.md)（工具与 harness）、[WORKFLOWS.md](WORKFLOWS.md)（plan/checkpoint 语义）、[CLI.md](CLI.md)（CLI 行为）。
- 术语：**写工具**指 `write_file` / `edit_file`；**命令工具**指 `run_command`；**提示词**指 `src/core/prompts.ts` 的 `CORE_INSTRUCTIONS`。
- **范围说明**：提示词与工具描述位于 `src/core/**` 与 `src/tools/**`，由 **CLI 与桌面共享**（同一 `HarnessService`、同一套工具定义）。本文的行为观察出现在 CLI，但修复点在共享层——这是本仓库的既有分层，不是越界。桌面侧的展示差异**不在**本文范围。

## 1 问题描述

在 Forge 中，模型经常**不用** `write_file`/`edit_file`，而是用 `run_command` 执行 `node -e "fs.writeFileSync(...)"`、`python -c "open(...).write(...)"`、`cat > file <<'EOF'` 等方式写文件。这带来若干实质问题（见 §2.4）。

## 2 根因分析（经代码核对）

### 2.1 硬事实：系统提示词**完全没有提到**写工具

`CORE_INSTRUCTIONS`（`src/core/prompts.ts:5-25`）是系统提示词核心，逐条点名了：`project_context`（`:13`）、`load_skill`（`:13`）、`update_plan`（`:15`）、`spawn_agent`/`list_models`（`:19-20`）。

**但没有任何一句提到 `write_file`、`edit_file` 或"用哪个工具写文件"。** 相关工作方式表述（`prompts.ts:14`）只说：

> "Make the smallest coherent change that solves the request."

——只讲**改多少**，不讲**用什么工具改**。因此模型缺少"写文件应用原生工具"的**任何指令性信号**。

### 2.2 硬事实：工具描述权重严重失衡

| 工具 | 描述来源 | 长度（约） |
| --- | --- | --- |
| `run_command` | `local.ts:200` 专属描述 | **≈1500 字符**（超时、64 KiB 上限、进程组终止、UTF-8 解码、HOME/PATH、网络策略……） |
| `write_file` | `local.ts:174` = `policies` + 一句 | ≈200 字符 |
| `edit_file` | `local.ts:183` = `policies` + 一句 | ≈180 字符 |

命令工具描述长度约为写工具的 **7 倍以上**。在工具选择上，这等于持续给 `run_command` 加权。

补充：`run_command` **没有**共享 `policies` 前缀；写工具**有**。该前缀（`local.ts:133`）内容为：

> "Workspace-relative only; no symlinks or sensitive files (.env*, credentials, private keys, .ssh, .config, .git). Files at most 2 MiB. **Readonly forbids mutations and commands.**"

纯限制性文本叠加在**短描述**开头，使写工具在语义上显得"约束多、能力弱"。

### 2.3 硬事实：写工具描述含**摩擦性**与**弱化性**措辞

`local.ts:174`（`write_file`）：

> "Atomically create/replace a file. **Parent must exist: use make_directory first.** Returns bounded real before/after previews, **not backups**."

- "**use make_directory first**"：把一次操作变成两步，模型容易改走 `mkdir -p && cat > f`（一次 `run_command`）。
- "**not backups**"：可能被读作"能力受限"。
- `edit_file`（`local.ts:183`）也有 "**Exactly one occurrence required unless replace_all is true**"，属正确约束，但同样只有约束、没有"这是首选编辑方式"的定位说明。

### 2.4 硬事实：命令工具写文件**绕过 checkpoint**（后果最严重）

checkpoint 的唯一注入点是 `commit()`（`src/tools/local.ts:478`），而它**只被 `write_file`（`:922`）与 `edit_file`（`:943`）调用**：

- `local.ts:542-557`：`commit()` 内 `options.checkpointStore.begin(...)` → `complete()`。
- `run_command`（`local.ts:974`）走 `command(args, context, signal)`，**不经过 `commit()`**。

因此：**用 `run_command` 调 node/python 写文件，不会产生 checkpoint**，用户**无法**通过 `restoreCheckpoint` 恢复。这与 `WORKFLOWS.md` 中"checkpoint 用于可恢复改动"的语义相悖，是本问题**最严重的实际后果**——而模型当前对此**完全无从知晓**，因为：
- 提示词没提；
- 写工具描述没说明它对 checkpoint 的意义；
- `run_command` 描述末尾"approved commands can access outside the workspace or network"（本意是**风险警告**）反而可能被读作**能力加分**。

### 2.5 结论

不是单一 bug，而是**三处叠加**：

1. **提示词缺失**写工具的首选性指引。
2. **工具描述失衡**：命令工具详实、写工具单薄且以限制开头。
3. **写工具摩擦**（先建目录）与**能力弱化**措辞，且**未申明 checkpoint 优势**。

模型选择 node/python 写文件，是对上述信号组合的**理性反应**。

## 3 优化目标

1. 当任务是"创建/修改文件"时，模型**默认**使用 `write_file`/`edit_file`。
2. 用户获得**可恢复的 checkpoint**（写工具路径），而非绕过 checkpoint 的副作用。
3. 不牺牲 `run_command` 的既有正当用途（构建、测试、git、包管理、运行脚本等）。
4. 保持提示词"字节稳定前缀"约定（`prompts.ts:3-4`：同一 run 输入生成稳定前缀），不在其中掺入随会话变化的内容。

## 4 非目标

- 不禁用 `run_command`，不禁用 shell，不改变其权限/审批模型。
- 不改变 `write_file`/`edit_file` 的 schema、原子性语义与权限判定。
- 不新增工具（除非 §6 的"可选增强"被采纳）。
- 不改动桌面展示层（`src/renderer/**`）。
- 不承诺撤销 `run_command` 的副作用能力（它不是沙箱）。

## 5 优化方案

### 5.1 P0：提示词增加"写文件首选"指引（最高收益）

在 `CORE_INSTRUCTIONS` 的"Working approach"中增加一条（措辞示意，非最终稿）：

> - Create or modify files with `write_file`/`edit_file` rather than shelling out to node/python/sed/cat. Use `run_command` for builds, tests, git, package managers and scripts, not for producing file content. File-editing tools produce recoverable checkpoints; shell writes do not.

要点：
- **明确"不是命令"**（切断 shell 写文件的联想）。
- **给出理由**（checkpoint 可恢复）而非仅禁止。
- 与既有"最小改动"语气一致，保持简短。

**约束**：该条必须**静态**（不含会话/时间/计数），以维持 `prompts.ts:3-4` 的字节稳定前缀约定。

### 5.2 P0：重写写工具描述（消除失衡与摩擦）

- **补齐能力与适用场景**：明确"创建/替换文件内容的**默认**工具"。
- **申明 checkpoint 优势**：例如 "Edits are recorded as restorable checkpoints"（写工具专属，命令工具**不能**这样声称——`§2.4` 已证实）。
- **改掉摩擦措辞**："Parent must exist: use make_directory first" → 陈述事实，如 "Fails if the parent directory does not exist (create it with `make_directory`)."
- **去掉易误读的 "not backups"**，或改为中性表述。
- **`policies` 前缀**：考虑把"Readonly forbids mutations and commands"这类不适用的句子从**写工具**描述中剥离（它同时约束了命令工具，混在一起反而稀释了写工具的能力说明）。

### 5.3 P1：压缩/重组 `run_command` 描述

`run_command` 的长描述信息量大但有大量**次要细节**（UTF-8 解码、进程组终止、编码上限等）。建议：
- 保留**风险与权限**要点（非沙箱、审批、cwd 守卫）；
- 把**运维细节**压缩或移入 `docs/CLI.md`/工具文档，而非全部塞进面向模型的描述。

目的：降低它在注意力上的相对权重（`§2.2`）。

### 5.4 P1：命令工具描述补一句"不用于写文件内容"

在 `run_command` 描述中加入一句低成本边界说明，例如：

> "For creating or modifying file content, use the file tools instead; shell writes are not checkpointed."

这是**在错误发生处**引导，成本最低、指向最明确。

### 5.5 P2（可选增强，需单独评估）

- **允许 `write_file` 自动创建父目录**（或加 `create_parents` 选项）：直接消除 `§2.3` 的摩擦根源。
  - 权衡：与"最小惊讶"及既有"父目录必须先存在"的显式语义冲突，需评估安全边界（不得因创建目录逃逸 workspace）。
- **命令工具写入检测/警告**：运行后若检测到文件变更，提示"此改动可能未纳入 checkpoint"。属**事后**补救，复杂度高，仅在 P0/P1 效果不足时考虑。

## 6 验收标准

- **AC-1**：在同一测试提示词与权限下，模型对"创建一个新文件""修改某文件某处"**默认**选择 `write_file`/`edit_file`（量化：此类任务中写工具使用率显著高于基线）。
- **AC-2**：模型**不再**主要用 `node -e`/`python -c`/`cat >` 写文件内容。
- **AC-3**：写工具产生的文件改动**可被 checkpoint 恢复**（沿用既有 `restoreCheckpoint` 路径验证）。
- **AC-4**：`run_command` 的正当用途**未退化**：构建、测试、git、包管理等仍正常选择命令工具。
- **AC-5**：提示词仍满足**字节稳定前缀**（同一 run 输入 → 相同前缀）；相关既有测试通过。
- **AC-6**：工具 schema **无破坏性变更**；既有工具测试（`tests/**` 中工具相关）通过。
- **AC-7**：`pnpm typecheck`、`pnpm test` 通过；按 AGENTS.md 本机流程 `node scripts/build-core.mjs` 后重开 `forge` 生效。

## 7 验证方法（可执行）

1. **基线采集**：固定一组写文件任务提示词（新建文件、局部编辑、多文件重构），在**当前**代码上跑 N 次，记录工具选择分布。
2. **改动后复测**：同一提示词再跑 N 次，对比写工具使用率（AC-1/AC-2）。
3. **checkpoint 验证**：用 `write_file` 改一个文件后 `restoreCheckpoint`，确认可恢复（AC-3）。
4. **回归**：确认构建/测试类任务仍走 `run_command`（AC-4）。
5. **提示词稳定性**：断言同一 run 输入下前缀字节一致（AC-5）。

**诚实声明**：本文根因分析基于**源码核对**（`§2.1-2.4` 均为可复核事实），但"是否会显著改变模型行为"属**高置信度假设**，**尚未**做 A/B 实测。AC-1/AC-2 必须**实测**才能声称达成。

## 8 风险与约束

- **提示词膨胀**：新增指引不得使 `CORE_INSTRUCTIONS` 明显变长（当前约 6 段），避免稀释其它指引。
- **字节稳定前缀**：任何新增内容必须静态，不得含会话/时间/计数（`prompts.ts:3-4`）。
- **过拟合单一模型**：不同模型对描述的敏感度不同；方案应基于**通用**信号（明确指令 + 描述平衡），而非针对某模型调参。修改后应在多个配置模型上抽测。
- **不要过度禁止**：若把 `run_command` 描述写得过于负面，可能损害其正当用途（AC-4）。
- **核心层共享**：改动影响 **CLI 与桌面**两条入口，需在两端做回归（本文不覆盖桌面展示）。
- **并发**：改动涉及 `src/core/prompts.ts`、`src/tools/local.ts`，实现前须确认无人占用。

## 9 待决问题

- **Q1**：`write_file` 是否允许**自动创建父目录**（消除摩擦，见 §5.5）？安全边界如何界定？
- **Q2**：checkpoint 优势是否应在**提示词**（`§5.1`）与**工具描述**（`§5.2`）**同时**申明，还是只留一处以避免重复？
- **Q3**：`run_command` 的运维细节应压缩到何种程度？是否移入 `docs/CLI.md`？
- **Q4**：是否需要为"写文件任务"补一条**回归测试**（结构/提示词断言），还是只做人工 A/B？
- **Q5**：`policies` 前缀是否拆分为"读/写/命令"三套，避免无关限制干扰写工具（`§5.2`）？

## 10 未验证项（诚实说明）

- 未做**模型 A/B 实测**；行为改变幅度**未知**。
- 未统计真实会话中该问题**发生频率**，"经常"来自用户主观观察与本文代码分析，**未量化**。
- 未验证**其它写路径**（如 MCP 工具、子代理）是否也存在同类绕过 checkpoint 的问题。
- 未评估 `run_command` 写文件**绕过 checkpoint** 之外是否还有其它一致性缺口（如并发写冲突检测）。

## 11 本轮实施与验证记录（2026-10-14）

### 已实施 P0/P1

- `src/core/prompts.ts` 的静态 Working approach 明确区分：新建/整体替换用 `write_file`，局部替换用 `edit_file`，缺父目录用 `make_directory`；不得以 node/python/sed/cat、重定向或脚本代替原生文件编辑。
- 保留构建、测试、git、包管理等命令用途；明确正常构建产物与人为改写源文件的区别。不禁用 shell，不新增运行时命令检测器，不修改命令执行权限和审批路径。
- 写工具描述以适用场景开头，再列出路径、敏感文件、2 MiB 和 readonly 边界。仍需显式创建父目录、literal old_text、唯一匹配或显式 replace_all；所有参数 schema 和执行逻辑未改。
- 提示词及工具描述均说明 checkpoint 区别，但使用条件性表述：**配置 checkpoint store 时**可恢复。源码 `commit()` 的 store 为可选依赖，不能无条件承诺恢复；默认 harness 已配置。预览与备份仍明确区分。
- 命令描述保留风险、权限、cwd、最小环境、超时、输出上限和取消语义，补上文件工具引导；PATH、UTF-8 等运维细节归档到 `docs/CLI.md`。
- P2（自动建父目录、命令后检测变更）本轮未实施；不扩展 schema、不隐式新增目录写入。

### 已观察的验证结果

`node node_modules/vitest/vitest.mjs run tests/core/prompts.test.ts tests/tools/local.test.ts tests/checkpoints/checkpoints.test.ts`：3 文件、27 用例通过。覆盖静态指引、原有 5000 字符预算、相同输入与跨工具轮次前缀稳定、文件工具 schema、readonly/敏感路径/原子编辑回归、命令正常执行，以及真实临时目录中 checkpoint 恢复（含超过预览长度的原文）。这些是确定性契约和执行测试，不是模型工具选择 A/B。

`node scripts/build-core.mjs` 编译成功；`node --check dist/cli.mjs` 与 `git diff --check` 通过。本机重开 `forge` 加载新产物；未运行全量测试、typecheck 或桌面打包。本轮未提交 Git，保留工作区修改。

### 仍未验证

- AC-1/AC-2 的真实模型选择率、跨模型变化幅度：**未做 A/B，不宣称达标**。文档早先关于描述长度权重和“理性反应”的分析属于假设，不能由静态源码证明因果。
- 未调用真实 provider、读取真实凭据或执行完整桌面视觉验收；共享层修改不涉及 renderer。
- 此次文本修改均使用原生文件工具；测试只操作临时夹具，不使用命令改写仓库源文件。
