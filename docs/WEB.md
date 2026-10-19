# 原生联网搜索与网页读取

搜索已改为 **Responses API 原生 `web_search` 工具**，不是同名本地函数，也不再请求 Bing RSS。模型服务端负责搜索、打开网页与页内查找，Forge 接收 `web_search_call`、进度、`url_citation` 注释和来源记录。`web_fetch` 仍是独立的指定 URL 本地读取工具，不是搜索失败后的自动替代。

## 启用原生搜索

```sh
forge config set --api-mode responses --web-search live
```

- `disabled`：关闭（未配置时也是关闭，避免对已有网关自动启用额外服务）。
- `cached`：声明 `{ "type": "web_search", "external_web_access": false }`，要求服务端只用缓存；仍会请求模型服务端，不是本机离线搜索。
- `live`：声明 `{ "type": "web_search", "external_web_access": true }`，允许服务端实时联网。

模型决定是否调用；开启不保证每个回答都会搜索。配置为共享运行设置；切到不支持的协议时需显式关闭。已有会话若绑定其他来源，需切到支持 Responses 的模型来源。

请求仍为 `store:false`，额外请求 `web_search_call.action.sources`。原始搜索项与注释随本地 `providerState` 保存，同一端点/模型续聊原样回传；切换端点/模型不回传外来原生项。结构化引用和搜索记录单独保存，CLI 实时输出、重开历史及 renderer 显示去重、有界的来源列表。检索来源与实际引用分开显示。外部内容是不可信资料，不是指令或真实性保证。

### 托管搜索的权限与费用

- 仅 Responses 支持；Chat Completions / Anthropic 不伪装成原生搜索。安装 SDK 或能请求 `/responses` 不代表当前网关/模型支持 `web_search`。
- 不支持时明确失败，不去掉工具重试，不静默降级到 Bing、其他搜索服务或浏览器。开启搜索的请求失败不自动重放，避免未知搜索执行和费用被重复。
- `readonly` / Plan 不声明搜索工具。`workspace` 每次可能搜索的模型请求发送前审批整次托管搜索；拒绝后不发送该次请求。`unrestricted` 不弹审批。标题生成、上下文压缩不启用搜索。
- 无法提前逐个审批服务端内部查询/网址。查询可能包含对话数据，可能另计费用；不要放入秘密、凭据或私有代码。`store:false` 不代表查询不出域，也不替代服务商数据保留政策。
- 本机 IP/DNS/端口规则不能约束托管搜索内部网络。缓存/实时行为依赖服务端遵守协议。权限修改无法撤回已经发出的搜索；取消会终止本机等待，但不保证远端未执行。
- 这是 Codex 式原生工具协议接入，**不保证复刻 Codex 内部服务、账号能力、搜索质量或 UI**。本地协议测试不证明某个真实网关可用。

本机更新方式：`node scripts/build-core.mjs` 后重新启动 `forge`。当前进程不会热更新；这不等于已构建桌面或 Web 分发产物。

## 使用

直接告诉 Forge，例如：

> 搜索 TypeScript 的官方文档，打开相关页面核实，再附上来源链接。

原生搜索由服务端组织查询，不是 `{query,count}` 形式的本地函数。以下是保留的 `web_fetch` 指定 URL 读取示例：

```json
{"url":"https://www.typescriptlang.org/docs/","limit":12000}
```

`web_fetch` 提取 HTML 标题、正文和链接，也支持 plain text、Markdown、JSON、XML/RSS、CSV 等文本。优先选择有足够文字的 `main`/`article`，移除脚本、样式、导航、页脚及显式隐藏内容。它是静态文本提取，不是完整的浏览器布局或文章识别引擎。

长文返回 `next_offset`，继续以相同 URL 加 `offset` 读取；偏移量和 `limit` 是 JavaScript UTF-16 字符位置，不是字节。默认每页 12000、最多 20000 字符。每轮缓存最近 8 个成功页面，分页不重复请求，也不重复审批。`refresh:true` 明确重新抓取；缓存淘汰、重开或下一轮可能重新请求。`fetched_at` 用于确认内容批次，`from_cache` 表示是否读缓存。

`truncated` 表示还有下一页或提取被截断；`extraction_truncated` 表示解析/提取达到上限，不能靠分页恢复缺失部分。最多提取 200000 字符，默认展示最多 20 个链接。所有网页内容都是不可信数据，不能成为更高优先级指令。

## 本机 web_fetch 的网络与权限边界（不适用于托管搜索内部）

- `readonly`／Plan 模式禁止联网，审批不能覆盖只读限制。`workspace` 每次实际 HTTP 请求前审批，显示完整 URL（包括查询）；每次重定向再次审批。拒绝后不发出该请求。`unrestricted` 不弹审批。
- 仅访问公网 HTTP(S) 标准端口，禁止 URL 用户名/密码、localhost、私网、链路本地、保留地址和特殊 IPv6 范围。
- 每个跳转重新验证 URL 和所有 DNS 结果；连接固定到已验证的 IP，保留原始域名的 Host/TLS 校验，防止 DNS 重绑定。最多跟随 3 次重定向，不允许 HTTPS 降级 HTTP。
- 无 Cookie、登录态、Authorization、Referer，也不继承环境代理。不加载页面子资源、不执行 JS、不自动重试或更换搜索服务。需要代理的网络环境可能无法直连，工具会如实失败。
- 一次调用网络流程总时限 20 秒（包括审批与 DNS），压缩前和解压后的响应分别最多 2 MiB，返回 JSON 最多 96 KiB；取消/销毁会终止活动请求。
- 已知当前模型配置密钥会从输出中脱敏，并阻止出现在请求中（含常见 URL 编码形式）；这不是对任意秘密的自动检测。
- 独立于 `browserAllowedOrigins`：这些限制不能放宽现有浏览器白名单，也不允许访问局域网。浏览器/MCP 仍按各自权限使用，不能用于绕过网络拒绝。

## 限制和故障

原生搜索可用性、缓存新鲜度、地域与排序由服务端决定；没有搜索结果不能据此声称“互联网上没有相关信息”。不提供自动搜索服务切换；网关拒绝时应检查原生能力，或用户显式关闭搜索继续。

不支持 PDF、登录页、验证码绕过、完整 JS 渲染和浏览器会话。网站返回的错误、超时或正文截断会明确标记；即便 HTTP 成功，网页本身也可能是反爬提示，需要模型核实内容，不能假装已经获取目标资料。

## 聚焦检查

```sh
pnpm exec vitest run tests/provider/web-search.test.ts tests/provider/responses.test.ts tests/core/web-search.test.ts tests/shared/web-search-display.test.ts tests/tools/web.test.ts tests/core/integration.test.ts
```

可选真实公网检查（默认测试跳过，不读取真实配置或密钥）：

```sh
FORGE_WEB_SMOKE=1 pnpm exec vitest run tests/tools/web-live.test.ts
```

公网检查仅验证当时的 `web_fetch` 网页读取，不证明原生搜索可用性。真实网关验证需在已配置、支持该能力的来源中显式启用后发起搜索；不能用公开网页连通性测试冒充原生搜索验证。
