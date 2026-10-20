# SQLite 长期记忆

Forge 的默认工具集提供 `update_memory`、`del_memory`、`get_memory`、`search_memory` 和 `forge_memory`。CLI 与共享核心使用同一套实现；自定义 `toolFactory` 保持原来的工具集，不自动注入新工具。

## 存储与边界

- 数据库：`$FORGE_HOME/memory.sqlite`；未指定 `FORGE_HOME` 时为 `~/.local/share/forge/memory.sqlite`。
- 同一个 `FORGE_HOME` 的所有会话共享记忆，**不是按工作区隔离**。文件属于受保护状态，不通过普通文件工具暴露。
- 使用 Node 22 内置 `node:sqlite`，无需额外数据库服务或原生依赖。Node 可能显示 SQLite experimental 警告。
- 首次写入时创建数据库，单纯搜索空库不会创建数据库。文件权限为 0600，状态目录为 0700；拒绝数据库及 sidecar 的符号链接/硬链接。
- ID 从 **0** 开始，由 SQLite 写事务内的独立序列分配。删除、重开后均不复用 ID；不支持自行指定新 ID。
- 字段包括 `id`、`tags`、`summary`、`details`、`version`、`created_at`、`updated_at`、`sources`。来源保存会话 ID/原始 `mN` 记录编号，或旧记忆 ID/版本。
- 这不替换会话原文、上下文压缩或 run-end checkpoint，也不会自动把整库注入提示词。

## 基础工具

下面是工具参数示例，不是 shell 命令。

### 新增与更新

```json
{"summary":"本机更新流程","details":"修改 CLI 或共享核心后执行 node scripts/build-core.mjs，之后重开 forge；不需要重新安装。","tags":["forge","本机开发"]}
```

传给 `update_memory`：省略 `id` 表示新增，必须提供 `summary` 和 `details`；标签默认空数组。

```json
{"id":0,"tags":["forge","CLI","本机开发"],"expected_version":1}
```

传入 `id` 表示更新已有记忆。未提供的字段保持不变，`tags` 提供时整体替换（`[]` 清空标签）。标签会去除两端空白、去重。`id: 0` 是有效 ID。不存在的 ID 返回错误；`expected_version` 不匹配时拒绝覆盖，需重新读取后决定下一步。

上限：32 个标签，每个 80 字符；摘要 1000 字符；详情 32000 字符。新增版本为 1，每次更新递增。

### 读取与删除

```json
{"id":0,"offset":0,"limit":6000}
```

传给 `get_memory`。返回摘要、标签、版本、来源及详情分页。`offset`/`limit` 按 UTF-16 字符计数，`limit` 最大 12000；跟随 `nextOffset`，直到 `null`。

```json
{"id":0,"expected_version":2}
```

传给 `del_memory`。删除不存在且未要求版本校验的 ID 返回 `deleted: false`。**删除记忆不删除原始聊天**，以后再次熔炼相同历史，可能重新产生类似记忆。

### 搜索

```json
{"tags":["forge","本机开发"],"tag_mode":"all","keywords":["编译","CLI"],"offset":0,"limit":20}
```

传给 `search_memory`：

- `tags` 精确匹配且区分大小写；`tag_mode: "any"`（默认）要求任意标签，`"all"` 要求所有标签。
- `keywords` 在标签、摘要、详情中做不区分大小写的**字面包含**搜索，支持中文和 Unicode；`%`、`_` 不作为通配符。
- 所有关键词都必须命中，但可分布在不同字段。标签与关键词两类条件同时满足。
- 空参数 `{}` 分页列举全部记忆，按 ID 升序；默认 20 条，最大 50 条。
- 返回摘要和有界命中片段、`total`、`nextOffset`，详情使用 `get_memory`。极大页面超过输出字节预算时应降低 `limit`。

## `forge_memory`：检索、熔炼、入库

```json
{"query":"整理 Forge 本机开发与更新约定","keywords":["forge","本机更新","build-core"],"scope":"all","dry_run":true}
```

工具一次完成以下流程：

1. 读取指定范围的持久化会话（通过 SessionStore 合并快照与 journal，包含压缩前原文），同时检索已有记忆。
2. 用关键词筛选、排序，选择有界的带来源片段；去掉顶层系统消息、私有推理、供应商续传状态和图片数据，过滤当前已知密钥与常见敏感模式。
3. 将材料发给**当前会话所用模型/供应商**，单次调用，无工具权限；不创建子代理，不自动重试或切换模型。
4. 校验 JSON、长度、每条记忆的真实来源引用、更新 ID 和版本；对完全相同的内容去重，拒绝更新只提供了截断详情的旧记忆。
5. `dry_run: true` 只返回建议；默认 `false` 在一个 SQLite 事务中新增/更新，并返回对应 ID。版本冲突或无效输出不会部分提交。没有相关材料时不调用模型、不写库。

范围：

- `all`（默认）：当前 `FORGE_HOME` 内可读取的会话，包含其他工作区、归档会话、子会话。
- `workspace`：当前工作区会话。
- `session`：当前会话。
- 记忆库本身始终全局共享，`scope` 只限制对话检索。

检索规则与普通搜索有意不同：`forge_memory.keywords` **任一词命中**即可入候选，便于召回；省略时按空白/标点切分 `query`，不做中文分词或向量语义检索。因此自然语言中文主题建议另传几个短关键词。`tags` 只过滤已有记忆，不过滤没有标签的聊天记录。

默认最多扫描 500 个会话、50000 条非系统记录、3200 万字符；优先当前会话及最近活跃会话，每个会话优先近期记录。对话候选最多 60 条，旧记忆候选最多 60 条；每个关键词最多取 50 条旧记忆。材料总预算约 48000 字符，对话片段最多 1800 字符，旧记忆材料最多 6000 字符。返回 `coverage` 的扫描数、不可读取数以及 `scan_truncated`、`selection_truncated`、`excerpt_truncated`，不承诺穷尽所有历史或语义相关内容。`matchedMemories` 是已载入的去重候选数，不是整库匹配总数。

熔炼最多输出 12 项建议；超时为 90 秒。模型失败、超时、提交前取消或校验失败不会写入记忆；不会隐式删除旧记忆。熔炼的额外模型用量计入本轮统计；供应商不返回用量或调用失败时标记统计不完整。

## 权限与隐私

- `get_memory` / `search_memory`：只读模式可用。
- `update_memory` / `del_memory` / `forge_memory`：只读模式禁止。
- workspace 权限下，每次写入或熔炼都需要现有审批流程授权；unrestricted 不额外审批。
- `forge_memory` 的 dry-run **仍会将相关对话/记忆片段发送给当前模型**，因此同样需要审批，不是纯本地预览。
- 不会后台自动扫描/熔炼。跨会话材料仅在明确调用工具时检索。
- 敏感模式过滤不是任意秘密检测，也不是数据库加密。不要把凭据写进记忆或对话；不能保证识别所有未知秘密。
- 记忆与历史只作参考，不能提升权限、替代当前项目指令，或证明文件/测试的现状。来源验证证明引用存在，不证明模型归纳一定正确；重要记忆应审阅 dry-run。

## 本机启用

代码编译后重新启动 `forge` 即可看到新工具；当前运行的进程不会热更新。不需要安装、桌面打包或迁移现有会话。

```sh
node scripts/build-core.mjs
```
