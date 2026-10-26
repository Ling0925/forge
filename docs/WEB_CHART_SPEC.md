# Web 会话图表渲染（```chart 围栏）

Web 会话区可以把助手回复中的 ```chart 围栏渲染为交互式图表（ECharts）。CLI、Android
配对页和编辑器不渲染图表，围栏在这些界面保持普通代码块。

## 两条通道

1. **显示通道**：助手消息正文中的 ```chart 围栏。`Markdown.tsx` 的 `pre` 渲染器在
   `language === "chart"`、消息已定稿（非流式）且 `enableCharts` 时解析围栏；解析失败
   自动降级为代码块，用户消息永远不渲染图表。
2. **校验通道**：`render_chart` 工具（仅 Web 宿主注册的 run 可用）。它只做纯校验，
   成功后返回规范围栏文本，模型原样粘贴进正文；失败返回逐项错误。工具结果中的围栏
   也会在工具卡片里预览（`tool-disclosure/content.tsx`）。

Web 宿主在转发 `startRun` / `enqueueInput` 时给 run 输入打上可信的 `uiHost:"web"`
标记（`src/web/server.ts`），Core 据此注册 `render_chart` 并注入提示词段
（`prompts.ts` 的 `has("render_chart")` 门控）。页面无法清除该标记；CLI 从不设置。

## 契约（Core `src/shared/chart-spec.ts`，Core 与 Web 共用）

顶层：`{ title?, note?, chart | raw }`，二者恰好选一。整体 JSON ≤ 200k 字符。

**友好层 `chart`**（渲染器编译为 ECharts option）：

| type | 必填字段 | 可选字段 |
| --- | --- | --- |
| `bar` | `categories`, `series:[{name?,values:number[]}]` | `horizontal`, `stack`, `title` |
| `line` | 同上 | `area`, `stack`, `title` |
| `bar-line` | `categories`, `bars`, `lines` | `stack`, `title` |
| `candlestick` | `categories`, `ohlc:[[open,close,low,high],…]` | `name`, `title` |
| `pie` | `series:[{name?,data:[{name,value}]}]`（单系列） | `donut`, `rose` |
| `funnel` | 同 pie | — |
| `radar` | `indicators:[{name,max?}]`(≥3), `series:[{name?,values}]` | — |
| `scatter` | `series:[{name?,points:[[x,y],…]}]` | `xTitle`, `yTitle` |
| `heatmap` | `xCategories`, `yCategories`, `data:[[xIdx,yIdx,value],…]` | `xTitle`, `yTitle` |
| `gauge` | `value` | `min`, `max`, `unit`, `name` |
| `table` | `columns`, `rows:[[string|number|null],…]` | — |

数值必须有限；每系列约 512 点上限，更大数据先聚合。

**原生透传层 `raw`**：`{ raw: { option: <ECharts option JSON> } }`，用于友好层覆盖不了
的图型（map/graph/tree/sankey/treemap/boxplot/calendar/parallel/themeRiver/sunburst 等，
渲染端已全量注册模块）。约束：JSON（不能有函数）、深度 ≤ 24、节点 ≤ 4000、单串 ≤ 2000
字符。

## 清洗与安全（Web `src/renderer/components/charts/sanitize.ts`）

- 围栏与工具参数都走同一个 zod 契约校验，非法 JSON 一律降级为代码块。
- `raw.option` 递归检查：拒绝含 HTML 标签 / `javascript:` / `data:text/html` 的字符串
  （ECharts tooltip 以 HTML 渲染，formatter 模板串是主要注入面）；拒绝 `on*` 事件键与
  `__proto__`/`constructor`/`prototype` 键；强制 `tooltip.appendToBody=false`，把模型
  提供的内容限制在图表容器内。
- 图表内容不执行脚本、不发网络请求；PNG 导出走 `getDataURL` 本地下载。

## 主题与交互

`theme.ts` 在 `data-theme` 变化时用 `getComputedStyle` 重新采样设计 token 并整体重绘，
明暗主题自动跟随。卡片提供：tooltip（ECharts 原生）、数据表切换（可访问性回退）、
PNG 导出、原始 JSON 复制。ECharts 通过动态 import 独立 chunk 懒加载，不进首屏包。

## 相关代码

- Core：`src/shared/chart-spec.ts`（契约）、`src/tools/chart.ts`（render_chart）、
  `src/core/harness.ts`（uiHost 门控）、`src/core/prompts.ts`（提示词段）、
  `src/web/server.ts`（可信标记）。
- Web：`src/renderer/components/charts/`（ChartCard / build-option / sanitize /
  theme / echarts 懒加载）、`workbench/Markdown.tsx`（围栏分流）、
  `primitives/tool-disclosure/content.tsx`（工具卡片预览）。
- 测试：Core `tests/shared/chart-spec.test.ts`；Web `tests/renderer/chart-*.test.ts`。
