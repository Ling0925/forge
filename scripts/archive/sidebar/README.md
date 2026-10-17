# 侧栏 QA 归档

这些脚本原位于仓库根目录的 `tmp.sidebar-*.mjs`，用于侧栏文件夹、长标题和渐隐效果的专项检查。它们挂载真实 Sidebar 与 CSS，使用 fixture 控制器和会话，不读取 Forge 配置、不调用模型。

这些是历史探针，未纳入默认测试入口。fixture、选择器和视觉阈值可能随当前 UI 变化；归档及语法检查不代表它们已在当前版本通过浏览器验收。

## 运行方式

先安装项目依赖，并准备 Playwright Chromium（`pnpm browser:install`），或通过 `FORGE_BROWSER_EXECUTABLE` 指定已有浏览器。**从仓库根目录运行**：脚本内的 `resolve(".")` 与源码导入按当前工作目录解析。

```sh
node scripts/archive/sidebar/qa.mjs
node scripts/archive/sidebar/fade-check.mjs
node scripts/archive/sidebar/shot.mjs
```

| 脚本 | 内容 | 输出 |
| --- | --- | --- |
| `qa.mjs` | 文件夹折叠、搜索等交互断言 | 控制台结果与 `.build/sidebar-qa/sidebar-qa.png` |
| `fade-check.mjs` | 比较遮罩前后标题边缘像素 | 控制台结果，截图仅保留在内存 |
| `shot.mjs` | 浅色、深色与 1440/390 宽度截图 | `.build/sidebar-qa/sidebar-<theme>-<width>.png` |

新截图写入 Git 已忽略的 `.build/sidebar-qa/`，不会覆盖下面保留的历史截图。

## 历史截图

以下是从根目录原样迁移的旧截图，本次整理没有重新生成，也不代表当前界面：

- [侧栏交互检查截图](../../../docs/archive/sidebar/sidebar-qa.png)（原 `tmp.sidebar-qa.png`）
- [浅色 1440 宽度截图](../../../docs/archive/sidebar/sidebar-light-1440.png)（原 `tmp.sidebar-light-1440.png`）

返回[文档索引](../../../docs/README.md)。
