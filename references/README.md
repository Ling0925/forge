# 本地参考源码

参考仓库独立保留自己的 Git 历史，不作为 Forge 的运行时依赖，也不将第三方源码重复提交进 Forge。这里只记录来源和复现方式；实施方案统一放在 `docs/`。

## Magpie

| 项目 | 值 |
| --- | --- |
| 官方仓库 | <https://github.com/yetone/magpie> |
| 本地目录 | `references/magpie/` |
| 同步日期 | 2026-10-20，Asia/Shanghai |
| 同步方式 | `main` 分支浅克隆，`--depth 1 --single-branch`；包含该提交完整工作树，不含完整历史 |
| 固定提交 | `2374ffe161439b02a8e7f23b793461b39a635bf8` |
| 上游提交时间 | 2026-10-20T14:11:21+08:00 |
| 上游提交说明 | gateway: a request whose agent goes while it waits for room ends its wait before giving its place back |
| 许可证 | MIT，Copyright (c) 2026 yetone，原文保留在 `magpie/LICENSE` |
| 实施规划 | [原生 TypeScript 模型接入规划](../docs/MODEL_ACCESS_TS_PLAN.md) |

这次仅下载、阅读源码，没有安装依赖、构建或启动 Magpie，也没有读取其用户配置和订阅凭据。该目录已从 Forge Git 和 Biome 扫描中排除；Forge 的 TypeScript、测试和 CLI 构建入口原本就限定在自身源码目录。

### 在其他检出目录复现

在 Forge 仓库根目录、且 `references/magpie` 尚不存在时执行：

```sh
git clone --depth 1 --single-branch https://github.com/yetone/magpie.git references/magpie
git -C references/magpie fetch --depth 1 origin 2374ffe161439b02a8e7f23b793461b39a635bf8
git -C references/magpie switch --detach 2374ffe161439b02a8e7f23b793461b39a635bf8
```

最后两步固定到本文版本，避免未来 `main` 已经前进。浅克隆不足以调查历史时，再按具体问题补取所需提交。

### 后续同步

只有明确需要更新参考版本时才同步。先检查本地修改和 `origin` 地址；有修改则保留现场，不做 reset、clean 或强制覆盖。先 fetch，再审阅新版本差异，确认后采用 fast-forward 或切换到指定提交，并更新此表及规划里的版本引用。不能把未经检查的新 `main` 当作本规划已覆盖的版本。

复制、翻译或改编上游实现、数据或测试时，在同一变更中保留适用版权与许可，登记来源文件和固定提交，并调整 Forge 对相关模块的原创声明。仅下载参考源码不表示已经完成移植或取得功能对等。
