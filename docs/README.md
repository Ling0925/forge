# Forge 文档索引

[项目首页](../README.md) · [本仓库工作约定](../AGENTS.md)

本机 CLI 更新使用 `node scripts/build-core.mjs`，然后重开 `forge`。开发入口与目录说明见项目首页；正式分发流程见 [DELIVERY.md](DELIVERY.md)。

以下按用途导航，保留现有文档路径。需求文档描述目标与验收标准，不能单凭标题或勾选项认定当前版本已通过验证；历史记录只对应其注明的时间、提交与检查范围。

## 使用与开发

| 文档 | 内容 |
| --- | --- |
| [CLI](CLI.md) | 命令、参数与交互行为 |
| [工作流](WORKFLOWS.md) | 模式、会话及跨入口操作 |
| [Web 开发工作台](WEB_DEV.md) | 开发服务、热更新、图片与 HTML 预览 |
| [Android 局域网客户端](ANDROID.md) | 桌面/Web 公开、扫码连接、核心共享与 Android 构建 |
| [桌面 Slash 命令](DESKTOP_SLASH_COMMANDS.md) | 桌面命令入口与共享行为 |
| [终端阅读与复制](TERMINAL_SELECTION.md) | Ink 阅读、选区和复制 |
| [会话归档与工作记忆](SESSION_MEMORY.md) | 会话归档、工作状态与回查 |
| [发布与交付](DELIVERY.md) | 安装、校验与回滚 |

## 架构、接口与设计

| 文档 | 内容 |
| --- | --- |
| [架构契约](ARCHITECTURE.md) | 模块边界、运行时、存储与宿主协议 |
| [视觉设计](../DESIGN.md) | 共享界面的视觉与交互契约 |
| [模型协议](PROVIDERS.md) | Chat Completions 与 Responses 适配 |
| [项目上下文](CONTEXT.md) | 项目指令与技能发现 |
| [MCP](MCP.md) | stdio、HTTP/SSE 扩展与工具调用 |
| [生命周期 hooks](TOOL_HOOKS.md) | 按需执行工具与收尾脚本 |
| [子代理工作树](AGENT_WORKTREES.md) | 独立修改、保留结果与合入 |
| [浏览器工具](BROWSER_TOOLS.md) | Playwright 集成及能力边界 |
| [路径保护](PATH_GUARD.md) | 工作区文件路径校验 |
| [运行时集成](RUNTIME_INTEGRATION.md) | 浏览器配置与 Provider 缓存指标 |
| [创作来源](AUTHORSHIP.md) | 开发来源与证据范围 |
| [参考调研](REFERENCE_DESIGN.md) | 设计参考及原创边界 |

## 需求与实施规格

| 主题 | 文档 |
| --- | --- |
| 审批 | [审核模式](APPROVAL_MODE_REQUIREMENTS.md)、[审批默认值](APPROVAL_DEFAULT_REQUIREMENTS.md) |
| 会话 | [生命周期](SESSION_LIFECYCLE_REQUIREMENTS.md)、[自动命名](AUTO_TITLE_REQUIREMENTS.md) |
| 模式与工具 | [模式切换](MODE_SWITCH_REQUIREMENTS.md)、[工具选择](TOOL_SELECTION_REQUIREMENTS.md) |
| 计划展示 | [CLI 计划固定](PLAN_PINNING_REQUIREMENTS.md)、[前端计划展示](FRONTEND_PLAN_REQUIREMENTS.md) |
| 界面 | [Markdown 渲染](MARKDOWN_REQUIREMENTS.md)、[动效](FRONTEND_MOTION_REQUIREMENTS.md)、[对话区动画与焦点优化计划](TRANSCRIPT_MOTION_AND_FOCUS_PLAN.md)、[思考自动收起与工具时序归并计划](TRANSCRIPT_ORDERING_AND_REASONING_PLAN.md)、[Web 布局](WEB_UI_LAYOUT_SPEC.md) |
| 前端改进方案 | [前端架构分析与优化方案](FRONTEND_IMPROVEMENTS.md) |

## 变更、迁移与历史记录

| 文档 | 范围 |
| --- | --- |
| [变更记录](CHANGES.md) | 已记录的功能变化及相关验证说明 |
| [Ink 迁移](TUI_MIGRATION.md) | CLI 迁移记录与当前终端架构说明 |
| [上下文与 TUI 优化](CONTEXT_TUI_OPTIMIZATION.md) | 2026-10-15 批次实现与检查记录 |
| [需求实现状态](REQUIREMENTS_STATUS.md) | 2026-10-15 状态快照 |
| [CLI 界面分析](CLI_UI_IMPROVEMENTS.md) | 历史手写终端实现分析，当前入口见 CLI 与 Ink 迁移文档 |
| [CLI 美学提案](CLI_AESTHETICS_AND_EVOLUTION.md) | 历史界面演进提案 |
| [早期实现说明](../IMPLEMENTATION_NOTES.md) | 初始方案，包含早期目录设想，不作为当前源码目录图 |
| [早期审查记录](../REVIEW_LOG.md) | 开发阶段检查点，不作为当前完整验收结论 |
| [侧栏 QA 归档](../scripts/archive/sidebar/README.md) | 历史浏览器探针、运行方式与截图位置 |
