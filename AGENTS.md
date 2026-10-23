# 本仓库的代理工作约定

## 源码与文档归属

- 主仓只维护子模块指针、装配脚本和导航。Core、CLI、Web UI 的唯一源码分别在 `repos/forge-core`、`repos/forge-cli`、`repos/forge-web-ui`；Android 在 `android`，四者独立提交。进入模块前读取其 `AGENTS.md`。
- 不创建根目录 `src/`，不复制子模块源码，不自动更新子模块到远端最新版本。主仓与子仓分别审阅、分别提交，不夹带其他任务的指针或修改。
- 保持 `android/` 路径，避免打断 Gradle、模拟器和 fixture 入口。
- 旧单体在 `codex/archive-monolith-20261023`（基线 `a568d4568ebe73057e8ef002c29117179b05bbef`）；本机旧工作副本及未提交 renderer 修改在已忽略的 `.archive/legacy-20261023/`。只供恢复，不参与开发、构建或默认搜索。恢复方法见 [模块与归档说明](docs/REPOSITORY_SPLIT.md)。
- README 提供使用入口，AGENTS.md 只保留长期工作约定，专题文档说明所属模块的机制。一次性任务分工、日志、旧机器状态不写成永久规则；技能只保留可重复执行的专门流程，不复制这些约定。

## 子代理模型

- 用户指定 **DeepSeek V4.1 Flash**：调用 `spawn_agent` 时 `model` 必须为 `cn:deepseek-v4.1-flash`。除非用户明确指定其他模型，不得因复杂度、额度、错误或工具预算换模型、自动 fallback 或重放失败任务。
- 模型缺失、不可用或调用失败时，先检查已产生的改动并如实报告；主代理可以接手，换用其他子代理模型须征得用户明确同意。
- 此规则不改变主代理模型，也不要求每个任务都委派。

## 本机 CLI：改代码 → 编译 → 重开

修改 CLI 或其共享核心后，在主仓根目录执行：

```sh
node scripts/build-core.mjs
```

- 构建顺序是 Core → 本地 `@forge/core` 链接 → CLI，不修改子仓 manifest 或锁文件。首次安装依赖用 `pnpm run setup`；日常不用重装。
- 本机 `~/.local/bin/forge` 运行 `/home/ling/services/desktop-harness/dist/cli.mjs`，仅转发到 `repos/forge-cli/dist/cli.mjs`。下次启动生效，当前进程不热更新；不代表其他机器已配置同样入口。
- 仅文档修改不编译。代码修改默认检查编译退出码、必要的语法/启动路径及聚焦行为，不把全量 test/typecheck/lint 或长时间 QA 作为本机更新前置条件。报告实际检查范围，不把编译通过当成功能验收。
- 启动检查使用临时 `FORGE_HOME`，避免读取真实密钥或改动会话，结束后清理。
- 不默认执行桌面构建、Electron 打包、release 校验或 `scripts/install-local.mjs`，不修改桌面入口和旧发布包。发现启动入口变化先检查并说明，不静默覆盖未知启动器或擅自重装。

## 每轮修改都要本地提交

- 有仓库改动时，收尾前完成本轮 `git add` / `git commit`；纯问答或只读检查不提交。
- 提交前检查 `git status`、diff 和暂存范围，只提交自己的改动。排除用户或并发任务修改、密钥、凭据、临时目录、构建产物。
- 使用 `feat:` / `fix:` / `docs:` 等现有风格。默认不 push，不 amend 他人提交，不 force push，不重置或丢弃用户未要求放弃的提交和工作区。
- 提交失败或无法安全分离他人改动时，报告阻塞并保留现场，不强行提交。

以上适用于本机源码开发。用户明确要求正式分发、桌面更新或完整验收时按对应范围执行；短路径不放宽权限、审批和秘密保护，也不允许自动重放结果不确定的副作用。
