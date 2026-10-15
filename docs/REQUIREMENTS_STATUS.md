# 需求实现状态（2026-10-15）

本表区分“已实现”与“全部验收”。源码实现不代表真实模型、所有终端或 Electron 正式发布已验收。

**TUI 后续更新**：默认终端已迁移 Ink，旧手写全屏/鼠标选区只保留测试 fixture；当前功能、冻结阅读、原生复制及验收范围见 [TUI_MIGRATION.md](TUI_MIGRATION.md)。

**后续更新**：用户要求 CLI 停止手写 Markdown，现已换成 `marked` + `marked-terminal` + `cli-highlight`。下表原“CLI 子集/轻量词法高亮”是上一批记录；当前语法、依赖、流式及验证范围以 `MARKDOWN_REQUIREMENTS.md` §12 为准（83 项聚焦用例 + 1 项编译产物隔离启动检查通过）。

| 需求 | 已实现 | 边界 / 仍未验证 |
| --- | --- | --- |
| MARKDOWN_REQUIREMENTS | 桌面 GFM、安全链接、本地代码高亮/复制、流式节流与超长降级；CLI 引用/水平线/基础表格，追加代码框及轻量多色高亮 | CLI 为明确子集；完整 Electron 历史长会话性能、OS 外部浏览器实际启动未验收 |
| MODE_SWITCH_REQUIREMENTS | CLI CSI Z、桌面普通输入区 Shift+Tab、同源 mode、文字/tone 反馈、busy 仅下一轮；本轮补齐 TerminalReader.ui 转发 | 新建任务模态使用下拉，不拦截反向焦点；跨终端键码、配色对比度矩阵未验收 |
| AUTO_TITLE_REQUIREMENTS | completed 后一次性命名、持久化来源、手动保护、模型请求 2 秒上限、本地降级、锁竞争协调 | 旧无标记标题不改；桌面宿主延迟重拉而非新增事件；真实模型质量/成本未测 |
| SESSION_LIFECYCLE_REQUIREMENTS | CLI 首句才创建、显式 /new、无会话命令安全处理 | 按方案 A，存量手动 archive；不增加自动删除或批量删除 |
| APPROVAL_MODE_REQUIREMENTS | 用户确认的 CLI 默认 full-access、manual/auto、ask 别名、权限钳制、警告/自动批准汇总 | 桌面仍按钮审批；非交互 unrestricted + --yes 约束不变 |
| APPROVAL_DEFAULT_REQUIREMENTS | manual 新鲜空回车批准 [Y/n]，粘贴/历史/取消/EOF 拒绝 | 不以未知输入/空白替代批准；真实终端误触率未量化 |
| PLAN_PINNING_REQUIREMENTS | 当前会话权威 plan 固定状态位、有界进度与步骤、恢复/新建同步；本轮补齐 Reader 转发 | 状态槽复用；极矮窗口隐藏，复制提示短暂覆盖；真实终端视觉矩阵未验收 |
| CLI_UI_IMPROVEMENTS | 12 类优化已有实现：滚动提示/到底、复制发送提示、重绘、多行/行编辑、响应式 Dock、历史、代码框/着色、diff 计数、紧凑 footer、resize 合并 | 历史显式 opt-in；复制仅声明 OSC52 发送；可选外部编辑器/OS 剪贴板程序不启用。详见该文 §5 |
| TOOL_SELECTION_REQUIREMENTS | P0/P1 静态提示词、文件工具/命令描述、checkpoint 条件说明、契约回归 | 不是任意命令写入检测器；模型 A/B 选择率未测。可选 P2 自动父目录/命令事后扫描未实施 |

## 当前验证范围

- 22 个聚焦测试文件、235 项通过：CLI 渲染/输入/审批/历史/布局/菜单/队列/机器输出、核心提示词、本地工具和 checkpoint。
- 严格类型检查 `node node_modules/typescript/bin/tsc --noEmit` 通过。
- 最后滚动提示刷新补丁复验 4 文件、17 项通过（与上述用例重叠，不相加）。
- `node scripts/build-core.mjs` 成功生成最新 `dist/cli.mjs`；`node --check dist/cli.mjs` 与 `git diff --check` 通过。本机重开 forge 生效；本轮未重新打包桌面，未执行 Git 提交。
- 子代理本轮均在提供方 HTTP 503 失败，无成果；主代理独立完成实现，未重放子任务。
- 不把历史批次的测试数相加冒充最终全量验收。完整测试、正式打包安装、真实 provider A/B 未作为本机 CLI 更新前置。

## 用户可见的保守决策

1. 历史默认关闭：`/history on` 在本进程开启并加载该工作区旧历史；`off` 停止并清空编辑器历史；`clear` 清空该工作区文件且关闭。不是会话消息存储开关。
2. 文件修改用原生 write/edit，命令只用于验证、构建等；本轮未通过命令改写源码/文档。
3. 不因“全部实现”自动执行不可逆会话删除、系统剪贴板命令、未知模型网络调用或发布安装。
