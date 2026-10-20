# Forge 提示词

主提示词在 `src/core/prompts.ts`。运行时使用当前工具目录、主/子代理身份、工作区、权限和项目指令组装它；会话历史中的旧提示词不决定新请求的权限。

## 按实际任务提供指导

- 通用部分负责理解目标、继续已授权工作、正确调用工具和按证据交付。
- 编辑、计划、历史检索、文件交付等操作说明按工具目录加入；子代理不接收主代理的委派操作说明。
- 小任务直接完成。计划用于需要持续跟踪的里程碑，子代理用于值得独立处理的任务，不按工具调用次数强制启用。
- 稳定指导放在动态运行信息之前；同样的工具和上下文输入产生同样的前缀，减少不必要的缓存变化。

自动压缩的提示词位于 `src/core/context.ts`；手动压缩的结构化工作状态位于 `src/core/working-memory.ts`。二者保留用户目标与约束、已作出的决定、证据、未完成事项和下一步，并区分助手建议与用户授权。结构化工作状态继续使用原有 JSON 字段和大小限制，原始历史仍可检索。

## 参考与取舍

本次参考 [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts/tree/d895c8dd541bd46267d8d109a3eb754d2197dfd4) 的场景化组织方式，主要借鉴以下主题，并按 Forge 的实际工具契约重新编写：

- [任务授权的连续性](https://github.com/Piebald-AI/claude-code-system-prompts/blob/d895c8dd541bd46267d8d109a3eb754d2197dfd4/system-prompts/system-prompt-task-approval-continuity.md)：明确的下一步直接执行，避免反复确认。
- [有节制地委派](https://github.com/Piebald-AI/claude-code-system-prompts/blob/d895c8dd541bd46267d8d109a3eb754d2197dfd4/system-prompts/system-prompt-subagent-delegation-restraint.md)：收益应超过重新建立上下文和协调的成本。
- [压缩后继续工作](https://github.com/Piebald-AI/claude-code-system-prompts/blob/d895c8dd541bd46267d8d109a3eb754d2197dfd4/system-prompts/agent-prompt-conversation-summarization-lean-variant.md)：保留用户约束和下一步，而非只列操作流水账。
- [简洁沟通](https://github.com/Piebald-AI/claude-code-system-prompts/blob/d895c8dd541bd46267d8d109a3eb754d2197dfd4/system-prompts/system-prompt-communication-style.md)：报告结果、重要发现和阻塞，避免逐次复述工具调用。

不引入 Claude Code 的身份、专用工具名、自动工作树策略或额外审批流程。提示词变化不替代运行时权限和参数校验。

## 修改后检查什么

`tests/core/prompts.test.ts` 与 `tests/core/prompt-runtime.test.ts` 检查实际工具目录的选择、前缀稳定性、动态权限、子代理身份、数据转义和旧历史的投影，不锁定自然语言句子。压缩回归检查引用、分片、失败回退和历史保存。模型是否真正理解新的指导，需要实际运行场景验证，不能由字符串断言证明。
