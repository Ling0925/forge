# 参考设计与原创边界

本文记录 Forge 在设计阶段研究过的外部 harness 参考，以及**由这些参考实际启发的设计选择**。它是研究记录，不是依赖声明。

**Forge 没有导入、fork、改编或依赖任何既有 harness 的源代码。**参考仅用于行为与架构层面研究。本文不声称"复制实现"，也不声称"完全对齐"（parity）任何参考产品的全部功能：参考产品的能力集合大于 Forge 当前实现，且 Forge 做了独立决策。来源 URL 只是研究出处，不是产品默认服务地址。

## 固定版本的主来源

所有链接固定到具体提交/文档版本，便于复核。

| 参考 | 固定主来源 | 实际观察到的行为 |
| --- | --- | --- |
| OpenCode 架构分层 | [opencode AGENTS.md @b4a57f6](https://github.com/anomalyco/opencode/blob/b4a57f6849b9a368439b5fc2511fe167db1a6863/AGENTS.md#L1-L4) | schema、core、protocol、server、client 责任分离 |
| OpenCode 项目指令自动发现 | [instruction.ts @b4a57f6](https://github.com/anomalyco/opencode/blob/b4a57f6849b9a368439b5fc2511fe167db1a6863/packages/core/src/config/plugin/instruction.ts#L38-L72) | 指令发现是运行期能力 |
| pi 资源加载 | [resource-loader.ts @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/src/core/resource-loader.ts#L184-L187) | 资源自动发现位于运行期 |
| pi skills | [skills.md @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/docs/skills.md#L41-L63) | 元数据发现与正文加载是两个阶段 |
| OpenCode 子代理 | [agents.mdx @b4a57f6](https://github.com/anomalyco/opencode/blob/b4a57f6849b9a368439b5fc2511fe167db1a6863/services/www/src/docs/content/agents.mdx#L110-L156) | 独立子会话，前台/后台执行，角色权限 |
| pi 默认范围与扩展示例 | [README @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/README.md#L15-L21) / [examples README @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/examples/extensions/README.md#L44-L51) | plan mode 与 subagents 是**扩展示例**，不是默认核心功能 |
| pi 压缩与会话 | [compaction.md @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/docs/compaction.md#L27-L49) / [sessions.md @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/docs/sessions.md#L20-L44) | 语义摘要与 provider 上下文投影保留原始历史；分支不重放副作用 |
| pi MCP | [mcp.md @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/docs/mcp.md#L1-L32) | **当前 pi 已包含 MCP 集成**（修正早期说法） |
| pi provider API 类型 | [types.ts @7d75a0e](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/ai/src/types.ts#L61-L71) | Completions 与 Responses 是两种不同协议 |
| Codex AGENTS 指令 | [agents-md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | 项目级指令约定 |
| Codex skills | [build-skills](https://learn.chatgpt.com/docs/build-skills) | 技能包约定 |
| Codex subagents | [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | 子代理约定 |
| MCP stdio 传输 | [transport spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | stdio 生命周期与分帧 |

## 由参考实际启发的设计选择

这些是**逐条对照**：参考给出了可观察行为，Forge 据此做出自己的（可能不同的）决策。

1. **共享核心 + 双入口**（参考 OpenCode 分层）：Forge 保留自己原有的单一共享 core，桌面 IPC 与 CLI 直接复用同一个 `HarnessService`；**不是**照搬 OpenCode 的多包边界。
2. **项目指令 = 运行期能力**（参考 OpenCode `instruction.ts`、pi `resource-loader.ts`）：Forge 自定义**有界**工作区来源与 provenance，绝不向上搜索父目录或 home。
3. **skills 元数据与正文分离**（参考 pi `skills.md`）：Forge 只把技能目录的元数据注入系统上下文，正文通过 `load_skill` 工具**按需**加载，并保留普通工具权限。
4. **子代理为独立会话**（参考 OpenCode `agents.mdx`）：Forge 采用**继承权限上限**作为自己的独立决策（`permissionCeiling`），并把深度限制为 1、并发上限设为 4；这**不是**对 OpenCode 行为的断言。
5. **plan mode / subagents 属于扩展而非默认核心**（参考 pi README 与 examples）：Forge 在**实现**中选择把 plan 作为运行模式、把子代理作为内置原生工具——这是一个**独立的设计决策**，不代表参考产品默认发布这些能力。
6. **语义摘要 + 不改动原始历史**（参考 pi `compaction.md`、`sessions.md`）：Forge 生成模型语义摘要（上限 8192 字符），保留稳定系统前缀，持久化 transcript 保持完整；分支（fork）只复制历史，**从不重放**被复制的调用。
7. **stdio MCP 优先**（参考 pi `mcp.md` 与 MCP stdio 规范）：Forge 先完成 **stdio 完整生命周期**，在做出任何远端/HTTP/SSE/OAuth 声明之前不声称支持它们。
8. **显式协议选择**（参考 pi provider `types.ts`）：Completions 与 Responses 通过显式 `apiMode` 选择，**不是** URL 替换或自动探测。

## 本地 CometixCode diff 研究

本轮参考 `references/CometixCode` 中 `src/tools/file_edit_tool/{mod.rs,ui.rs}`、`src/tools/file_write_tool/{mod.rs,ui.rs}`、`src/components/structured_diff.rs` 与 `structured_diff_list.rs` 的数据分层和展示行为：工具执行时生成结构化 patch、编辑与覆写共用组件、带行号和行内强调、新文件单独预览。参考仓库 LICENSE 为 AGPL-3.0；未复制其 Rust 源码或引入其依赖。

Forge 独立实现 `src/shared/diff.ts`，将本仓库已有的有界 Myers 算法移到共享层，保留原文比较、明确区分计算失败和保存截断，继续限制持久化预览大小；CLI 消费记录而非重新读盘。采用本仓库字素宽度/终端过滤器及语义 Tone，不移植参考项目的色彩/语法解析栈，不承诺逐像素一致或全屏 diff 功能对等。

## 明确不声称的事项

- 不声称复制了任何参考实现，或与其达到功能对等。
- 不声称当前 pi 的默认核心包含 subagents/plan（它们是扩展示例）。
- 不声称对远端 MCP / OAuth / HTTP / SSE 的支持（Forge 仅实现 stdio）。
- 不声称 OS 沙箱。已批准的 MCP 服务器进程与 harness 同权限运行；审批只是让这一点**逐次显式化**。
- 不声称通用 provider 网关互通：本地 HTTP fixture 只验证实现的线协议行为；具体部署请对你自己的网关验证（见 [PROVIDERS.md](PROVIDERS.md)）。模型 ID 与端点属运行期私有配置，不在文档中暴露。
