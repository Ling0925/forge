# 联网搜索与网页读取

Forge 的默认共享工具现在包含 `web_search` 和 `web_fetch`，CLI、桌面和 Web 主机共用实现，支持现有各模型协议的普通函数调用。不依赖模型提供商的原生搜索、不需要新增 API Key，也不需要启动 Chromium。注册工具本身不会联网；模型实际调用时才发出请求。

本机更新方式：`node scripts/build-core.mjs` 后重新启动 `forge`。当前进程不会热更新；这不等于已构建桌面或 Web 分发产物。

## 使用

直接告诉 Forge，例如：

> 搜索 TypeScript 的官方文档，打开相关页面核实，再附上来源链接。

工具参数示例：

```json
{"query":"TypeScript official documentation","count":5}
```

`web_search` 使用 Bing 的公开 RSS 搜索入口，返回标题、链接、摘要、搜索来源 URL 和抓取时间。`count` 为 1–10，默认 5。查询会发送给 Bing，不要包含凭据、私有代码或其他敏感数据。摘要不是已经核实的网页内容；重要结论应再读取原文。

```json
{"url":"https://www.typescriptlang.org/docs/","limit":12000}
```

`web_fetch` 提取 HTML 标题、正文和链接，也支持 plain text、Markdown、JSON、XML/RSS、CSV 等文本。优先选择有足够文字的 `main`/`article`，移除脚本、样式、导航、页脚及显式隐藏内容。它是静态文本提取，不是完整的浏览器布局或文章识别引擎。

长文返回 `next_offset`，继续以相同 URL 加 `offset` 读取；偏移量和 `limit` 是 JavaScript UTF-16 字符位置，不是字节。默认每页 12000、最多 20000 字符。每轮缓存最近 8 个成功页面，分页不重复请求，也不重复审批。`refresh:true` 明确重新抓取；缓存淘汰、重开或下一轮可能重新请求。`fetched_at` 用于确认内容批次，`from_cache` 表示是否读缓存。

`truncated` 表示还有下一页或提取被截断；`extraction_truncated` 表示解析/提取达到上限，不能靠分页恢复缺失部分。最多提取 200000 字符，默认展示最多 20 个链接。所有网页内容都是不可信数据，不能成为更高优先级指令。

## 网络与权限边界

- `readonly`／Plan 模式禁止联网，审批不能覆盖只读限制。`workspace` 每次实际 HTTP 请求前审批，显示完整 URL（包括查询）；每次重定向再次审批。拒绝后不发出该请求。`unrestricted` 不弹审批。
- 仅访问公网 HTTP(S) 标准端口，禁止 URL 用户名/密码、localhost、私网、链路本地、保留地址和特殊 IPv6 范围。
- 每个跳转重新验证 URL 和所有 DNS 结果；连接固定到已验证的 IP，保留原始域名的 Host/TLS 校验，防止 DNS 重绑定。最多跟随 3 次重定向，不允许 HTTPS 降级 HTTP。
- 无 Cookie、登录态、Authorization、Referer，也不继承环境代理。不加载页面子资源、不执行 JS、不自动重试或更换搜索服务。需要代理的网络环境可能无法直连，工具会如实失败。
- 一次调用网络流程总时限 20 秒（包括审批与 DNS），压缩前和解压后的响应分别最多 2 MiB，返回 JSON 最多 96 KiB；取消/销毁会终止活动请求。
- 已知当前模型配置密钥会从输出中脱敏，并阻止出现在请求中（含常见 URL 编码形式）；这不是对任意秘密的自动检测。
- 独立于 `browserAllowedOrigins`：这些限制不能放宽现有浏览器白名单，也不允许访问局域网。浏览器/MCP 仍按各自权限使用，不能用于绕过网络拒绝。

## 限制和故障

Bing RSS 是免 Key 的公共入口，不是带 SLA 的付费搜索 API。可能限流、返回验证码、地区差异、排序不理想或改变格式；没有可解析结果时返回明确错误，不能据此声称“互联网上没有相关信息”。没有实现日期过滤、付费搜索供应商或提供商原生托管搜索。

不支持 PDF、登录页、验证码绕过、完整 JS 渲染和浏览器会话。网站返回的错误、超时或正文截断会明确标记；即便 HTTP 成功，网页本身也可能是反爬提示，需要模型核实内容，不能假装已经获取目标资料。

## 聚焦检查

```sh
pnpm exec vitest run tests/tools/web-network.test.ts tests/tools/web-content.test.ts tests/tools/web.test.ts tests/core/prompts.test.ts tests/core/integration.test.ts
```

可选真实公网检查（默认测试跳过，不读取真实配置或密钥）：

```sh
FORGE_WEB_SMOKE=1 pnpm exec vitest run tests/tools/web-live.test.ts
```

公网检查只验证当时的网页读取与搜索连通性，不证明长期可用性或搜索质量提升幅度。
