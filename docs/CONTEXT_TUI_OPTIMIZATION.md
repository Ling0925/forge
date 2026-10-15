# 上下文与 TUI 参考优化（2026-10-15）

本批基于 `0d518b6`，参考本地 CometixCode 的设计思路，不移植 Rust 组件，也不将参考源码纳入 Forge 发布。

## 本批实现

### 上下文摘要

- `src/core/summary-segments.ts`：优先按消息和完整 assistant 工具调用/结果交换分组，再按单次字符预算打包。借鉴 `services/compact/grouping.rs` 的分组边界思路。
- 单组超过预算时仍需分片；明确携带消息范围及 part/parts，不宣称超长组绝不拆开。摘要输入是带“不可信”标记的文本，不是拆开的原生 tool 消息。
- `src/core/context.ts`：摘要中途失败时保留最后成功合并的部分记忆（无成功时保留前次记忆），列出未摘要范围及有限摘录。为最低预算保留记忆空间，不再用开头警告挤掉全部记忆；所有记忆仍是不可信数据，不是权威指令。
- 最多 16 次摘要请求；预计算超过上限时直接降级，不自动重试。取消抛出 cancelled，不返回部分摘要。原始会话消息、工具结果和 continuation 不变。
- 80% 自动阈值、近期轮次保留和固定工具结果投影不变；不是新的滑动上下文淘汰策略，不承诺 provider 缓存命中率。

### Markdown 与本地缓存

- `src/cli/render/markdown.ts`：保留 marked/marked-terminal/cli-highlight。借鉴 `components/markdown_table.rs` 的窄屏纵向显示：列过窄或按显示宽度估计单元格需超过 4 行时，展示 Row N + 列名/值；宽屏普通表仍用库的边框/对齐。
- 保留中文、emoji、转义管道与行内样式；仍按 GFM 表头列数处理。超过 12 列或整段超出原有解析上限仍走原有源码降级。
- `markdown-cache.ts`：完成消息按净化文本和宽度缓存最终 RichLine，LRU 最多 128 条、成本预算 2,000,000（UTF-16 文本 + 保守 span/行开销，不是 JS 堆内存实测硬上限）。读写均复制，防止调用者污染缓存。流式前缀不入 LRU；流式当前消息仍逐次解析。
- 这是本地**渲染缓存**，不是 API prompt cache，也不是宽度无关的 AST 缓存。已提交历史 resize 自动重新解析仍未实现。

### TUI 分层

- `src/cli/terminal/view.ts`：借鉴 fullscreen_layout 的内容区/底部区职责划分，在固定屏高度 ≥30 行、无菜单/picker/审批时，预留独立辅助行显示计划/历史/短暂提示，下一行保留 thinking/当前工具、耗时和 token 信息。
- 预留取决于窗口几何与交互模式，不取决于后台有没有计划/状态，避免后台更新推动输入行。
- 更矮窗口继续复用单槽且活动优先；极矮窗口保留输入和光标。审批和菜单不新增辅助行。不重写 controller/screen/按键协议。

## 验证

- `node node_modules/vitest/vitest.mjs run` 指定 18 个文件：context-segments、context-budget、tool-context、evolution、fork-summary、runtime；markdown-cache、render-v2-markdown、render-v2、dock-layout、terminal-v2-plan、thinking-status、ui-improvements、picker-details、terminal-v2、fixed-screen、pending-input、machine-golden-v2：**136/136 通过**。
- `node scripts/build-core.mjs` 成功生成 CLI；`node --check dist/cli.mjs`、`git diff --check` 通过。另 `node node_modules/vitest/vitest.mjs run tests/cli/markdown-bundle.test.ts` 1/1 通过，使用临时 FORGE_HOME 启动 --help 并清理。
- 额外运行 `tests/core/continuation.test.ts`：取消摘要用例通过，`persists exact assistant continuation and forks child security provenance` 的 permissionCeiling 断言失败。本批未修改 harness/fork/store；该失败路径未调用 summarize。子代理报告在基线也复现，但主代理没有以 stash 再次切换基线。此项未解决，不计入上述通过数。
- 本批开了 3 个 `cbcn/deepseek-v4.1-flash` 子代理；上下文任务交付后由主代理修正信任措辞、降级预算和测试。两个 TUI 子任务响应协议错误、无残留文件；核对状态后由主代理完成有界实现，未重放子任务。

## 未完成 / 未验收

- 子代理实时进度事件接线、工具操作分组折叠、Markdown AST 解析缓存留待下一批，不算已实现。
- 未测真实模型摘要质量/成本、所有终端和 tmux 视觉表现、完整 Electron 工作台、全量测试或正式打包安装。
- 本机重开 forge 使用编译产物，运行中的进程不会热更新；无需重新安装。
