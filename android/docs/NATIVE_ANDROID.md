# Forge Native：Kotlin 原生聊天客户端

## 定位

`nativeApp/` 是独立的 Android 应用，不是 WebView 换皮。新应用使用 Kotlin、Jetpack Compose、Material 3；原来的 Java/WebView `app/` 保留，两个 debug 包可以并存安装。

- `dev.forge.nativeapp.debug` / **Forge Native**：新版聊天客户端。
- `dev.forge.mobile.debug` / Forge Mobile：原有 Web 工作台兼容客户端。

手机只负责交互、临时消息投影与连接。模型接入、会话持久化、工作区、工具执行、审批权限、运行生命周期继续由远端 Core 持有。关闭 App、切后台、断开连接都不发送取消；只有点“停止”才发 `cancelRun`。停止 Core 服务本身的行为由 Core 决定。

## 原版工作台迁移（0.2）

界面不再沿用首版的简化聊天布局。视觉与页面结构直接对照 `src/renderer/components/workbench/`、`styles/workspace-theme.css` 和 `styles/sidebar-compact.css`：原版最终生效的是暖白 / 石墨黑 / 赤陶强调色，而不是 `tokens.css` 的早期绿色基础色。保持 Kotlin + Compose，不嵌入 React 或 WebView。

**0.3 视觉重构** 把 Web 工作台的排版密度真正搬进 Compose，而不是只抄颜色：

- 打包 Geist / Geist Mono 字体（SIL OFL，见 `nativeApp/src/main/assets/fonts/OFL.txt`）；中文仍回退系统 Noto/PingFang，`f.` 字标保留 Georgia 风格的 serif italic。
- 统一 `ForgeDimens`：44dp 宽屏 / 56dp 手机标题栏、28–36dp 控件、264dp 侧栏、760dp 阅读宽度、4/6/8/12/14/18dp 圆角；不再默认使用 Material 的 48dp 按钮和 56dp 输入框。
- 首页欢迎内容在可用高度内居中，输入舱固定在底部；输入舱的 workspace 触发器移到卡片外，只显示叶子名，完整路径放在语义里；队列为空时不再占用一行。
- 对话流改为底部对齐，用户回合使用 16dp 内边距的 soft 气泡，助手为无边框正文；作者/复制行 26dp，思考/工具折叠行 32dp，代码块使用 Geist Mono 与 1px 暖灰边框。
- 设置、详情和用量共用扁平 `ForgeSectionCard`（soft 标题条 + hairline 边框）、32dp 分类切换、38dp 字段和紧凑保存栏；旧的材料风格 AlertDialog 仍用于确认类流程。

- **工作台**：`f.` 欢迎标识、原版欢迎文案、最近四项任务、紧凑标题栏；手机侧抽屉与详情切换，宽屏 264dp 常驻侧栏和可收起的详情面板。
- **会话导航**：按工作区分组、搜索任务/工作区、归档筛选、状态标记、重命名、归档/恢复与分叉。
- **输入舱**：一体化无内框文本区；独立 Build/Plan 和权限选择；来源/路由/模型选择，全局思考强度；发送、停止、显式排队与插话，队列取消/暂停/恢复。`unrestricted` 需要用户明确选择并确认；不自动升级权限或审批。
- **图片**：通过 Android 系统选择器选图，最多四张、单张 2 MiB；原生缩略图/历史图片显示、纯图片发送；附件仅保留内存并按服务器/会话隔离，不写入偏好设置。
- **对话流**：WebSocket 增量、历史分页、思考折叠、安静工具行、Markdown 子集/表格/代码复制、安全 HTTP(S) 链接；向上阅读时不强制拉回。
- **执行详情**：全局审批入口、计划与进度、子会话、文件目录/预览、真实变更/检查点差异与确认恢复、会话诊断和项目指令/技能资源。
- **分类设置**：模型来源基本增删改/启用及独立目录，推理、外观、执行、上下文、浏览器、LSP、MCP stdio 注册/启停/移除、服务器连接。远端设置只提交明确改动的字段；本地主题不修改远端主题。
- **用量页**：真实 Core 返回的 tokens、模型/日期/会话统计；缺失价格明确显示未知，不把未知当成免费。
- **连接安全**：设备凭据或一次性配对；凭据仅进程内保存。关闭页面、断线或切后台不取消远端运行。
- **不自动重放**：发送、创建、设置、来源、队列、检查点、审批等副作用不自动重试。结果不确定时保留输入并锁住写操作，用户刷新检查后才能显式解锁。各分区读请求按连接/会话/请求版本丢弃过期响应。
- **草稿**：文本按服务器地址 + 会话 ID 存入应用私有 SharedPreferences，旋转保留 ViewModel；图片不是离线持久化附件。

这次迁移包含页面和对应 Core 操作，但不是桌面全部高级功能的逐项等价实现。字体已打包 Geist / Geist Mono（OFL），CJK 字形由系统字体回退；桌面 OAuth、复杂路由编辑等剩余项见文末。

## 接入现有 forge-core

协议实现参考本地 `repos/forge-core` 基线 `4f6909c8da36dfaddb83b1a8376cf392fe6a45db`：

- `src/web/server.ts`
- `src/shared/ipc.ts`、`schemas.ts`、`host.ts`、`session-page.ts`
- `src/host/controller.ts` 的 recovery 与审批逻辑
- `src/core/runtime.ts` 的 generation 身份/消息位置

不新增手机专用后端 API，也不要求 Core 提供 Web renderer。Core 协议尚非单独发布的冻结移动 API，升级 Core 后应重新运行联调测试。

### 服务器

先使用现有 Core 配置好模型和工作区，再启动其 API 服务。Core 的实际启动选项以 `node dist/web/serve.js --help` 为准。典型命令（在 forge-core 目录执行）：

```sh
node dist/web/serve.js --workspace /absolute/project --host 192.168.1.10 --port 5173
```

Android 连接地址填写：

```text
http://192.168.1.10:5173/
```

Core 默认 trusted LAN 入口可不填凭据。只有部署为设备鉴权 host 时才填它签发的设备凭据，或选择“一次性配对码”。客户端不会创建账号，也不会读取手机或服务器上的模型密钥。一次性配对失败时不自动再次交换，需先在服务器检查设备状态。

**安全与代理注意事项：**

- Core 会严格检查 HTTP/WS 的 `Host` 和 `Origin`。直连时应使用 Core 的实际监听地址；`0.0.0.0` 通配监听或不同别名并不等于任意 Host 都被接受。
- 原生端显式发送 `Origin: scheme://host:port`，以及同一 authority 的 `Host`。WebSocket 升级也带相同身份。
- 反向代理需正确转发/重写到 Core 配置的 Host、Origin，并支持 WebSocket Upgrade；HTTPS 外层与 Core 内层 origin 不同时尤其需要代理配置。客户端不绕过 Core 的检查。
- 地址允许代理路径前缀（如 `https://example.com/forge/`），代理必须将该前缀下的 `api/*` 转到 Core 根 `/api/*`。
- HTTP 没有加密，只用于可信网络；不要把 trusted LAN 模式直接暴露到不可信公网。公网使用合适的 HTTPS/访问控制部署。
- 保持系统 TLS 证书校验，不接受“忽略证书错误”。不跟随重定向，避免凭据转发到另一个地址。
- 不支持网页登录、验证码或反向代理 HTTP Basic/Digest 交互；需要这些能力时暂用原有 WebView 客户端。

### 协议速览

| 用途 | 请求 |
| --- | --- |
| 一次性配对（可选） | `POST /api/pair`，`{token}`，取得 `credential` |
| 握手 | `POST /api/connect`，`{}`，取得 workspace/clientId/cursor/recovery |
| RPC | `POST /api/rpc`，`{id: UUID, method, ...fields}`，头 `X-Forge-Client` |
| 实时事件 | `/api/events?clientId=…&cursor=…` WebSocket，接收 `{cursor,events:[{runId,event}]}` |
| 确认事件 | WebSocket 发送 `{cursor}`；逐批校验连续性，不吞掉游标缺口 |
| 恢复探测 | `POST /api/connection`，`{cursor}`；不可恢复/410 时新握手并重新读状态 |
| 列表/活动运行 | `listSessions`、`listModels`、`getHostState` |
| 历史分页 | `getSessionPage` + sessionId；`page.before` 上一回合，`page.from` 刷新已加载窗口 |
| 新建/发送 | `createSession` + input.workspace；`startRun` + input.sessionId/prompt/mode/permission/model? |
| 停止/审批 | `cancelRun` + runId；`answerApproval` + runId/approvalId/approved |
| 会话操作 | `renameSession`、`archiveSession`、`forkSession`、`compactSession` |
| 设置/来源 | `getSettings`；`updateSettings {input:{settings:patch}}` / `{input:{source:operation}}` |
| 排队/插话 | `enqueueInput`、`listInputs`、`cancelInput`、`pauseInputs`、`resumeInputs`、`steerRun` |
| 文件/检查点 | `listWorkspaceEntries`、`readWorkspaceFile`、`listCheckpoints`、`getCheckpointDiff`、`restoreCheckpoint` |
| 详情/用量 | `getProjectContext`、`getDiagnostics`、`getUsageStats` |
| MCP | `listMcpServers`、`registerMcpServer`、`setMcpEnabled`、`removeMcpServer` |

只有 WebSocket 首批事件就绪且状态同步成功后才允许发送。HTTP 请求关闭 OkHttp 自动连接重试，RPC 校验 id/method；错误不会自动生成新的请求 ID 重放副作用。

## 代码结构

```text
nativeApp/src/main/java/dev/forge/nativeapp/
├── MainActivity.kt       # 生命周期、edge-to-edge、Compose 入口
├── ChatModels.kt         # 会话、消息与工作台状态
├── WorkbenchModels.kt    # 分区快照、图片与工作台动作契约
├── WorkbenchProtocol.kt  # 纯 JVM RPC 参数与数据投影
├── CoreTransport.kt      # HTTP RPC、鉴权、WS 批次与 ACK、安全地址解析
├── ChatViewModel.kt      # 状态、重连、分页、草稿、工作台动作和审批
├── Transcript.kt         # 绝对消息位置 + generationId 合并快照/流，防重复
└── ui/
    ├── ForgeTheme.kt     # 原版暖白/石墨/赤陶色、排版与线形图标
    ├── ForgeScreen.kt    # 自适应主壳、欢迎、导航和错误状态
    ├── ForgeSidebar.kt   # 分组会话与操作
    ├── ForgeComposer.kt  # 输入舱、图片、队列
    ├── ForgeModelPicker.kt # 模型/来源/路由/全局思考强度
    ├── ForgeConversation.kt # 消息、思考、工具与审批
    ├── ForgeInspector.kt # 计划、文件/检查点、会话与项目资源
    ├── ForgeSettings.kt  # 分类设置、模型来源和连接
    ├── ForgeUsage.kt     # 用量
    ├── PanelComponents.kt # 面板公共组件
    └── MessageContent.kt # 不执行 HTML 的 Markdown 子集
```

最多缓存 12 个会话投影；实时事件通道有界，积压时断开并按游标重同步，不静默丢事件。HTTP 响应上限 16 MiB；极大单回合超限会提示失败，不声称支持无限上下文。服务端依然是消息真相来源，手机没有离线可发送队列。

## 构建与验证

需要 JDK 17/21、Android SDK Platform 35，Gradle wrapper 8.9。依赖版本在 Gradle 中固定，不要求使用最新版本。

```sh
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=/path/to/Android/Sdk
./gradlew :nativeApp:assembleDebug :nativeApp:testDebugUnitTest
./gradlew :nativeApp:lintDebug
adb install -r nativeApp/build/outputs/apk/debug/nativeApp-debug.apk
```

原生设备测试先按 `NATIVE_FIXTURE.md` 启动离线真实 Core 路由，再执行：

```sh
adb reverse tcp:18765 tcp:18765
./gradlew :nativeApp:connectedDebugAndroidTest
```

设备测试使用真实 Android Activity/Compose、HTTP/WebSocket 和 Core controller，但 provider/tool 是隔离 fake。它不读取真实 Forge 配置、不使用真实模型额度，不等于公网或真实模型端到端验收。测试截图保存在模拟器 `/sdcard/Download/native-*.png`，可用 adb pull 取出。

### 安装包体积预算

Debug 和 Release **应用 APK 必须严格小于 10,000,000 字节（10 MB，不是 10 MiB）**。`:nativeApp:assembleDebug` / `assembleRelease` 自动执行对应的 `checkDebugApkSize` / `checkReleaseApkSize`，检查刚生成的 APK；达到或超过上限就让构建失败，不再把超限包当作成功交付。单独的 instrumentation 测试 APK 不属于应用安装包预算。

- **Debug**：启用 R8 未使用代码裁剪与资源裁剪，仍保持 `debuggable=true`、原包名后缀、debug 签名、应用类/成员名称及调试信息；不优化或混淆代码。`proguard-debug.pro` 保留应用代码，以及独立测试 APK 会调用的共享运行库 API，避免测试所需方法被误裁掉。
- **Release**：启用代码优化、混淆和资源裁剪。仓库不配置正式签名材料，当前输出仍是 `nativeApp-release-unsigned.apk`，不能直接安装，也不作为正式分发包。
- 移除当前源码没有使用的 `ui-tooling` / `ui-tooling-preview`；没有删减聊天功能、语言或 CPU 架构。若以后引入 Compose Preview，应明确恢复所需依赖并重新检查体积。
- `proguard-android-test.pro` 只忽略 AndroidX Test 引用的两种可选静态分析注解；不对应用运行库做全局 missing-class 忽略。
- 构建提示 Debug 同时启用 minify、不会进行优化/混淆，是保留调试能力的预期行为；未使用代码/资源裁剪仍会执行。

本机验证中，切换裁剪配置后的旧增量 APK 曾留下明显 ZIP 空洞。首次切换配置或交付紧凑包时使用模块级 clean；日常构建无需每次清理：

```sh
./gradlew :nativeApp:clean :nativeApp:assembleDebug
# 也可单独构建并检查对应变体；检查任务依赖实际 APK 产物
./gradlew :nativeApp:checkDebugApkSize
./gradlew :nativeApp:checkReleaseApkSize
```

### 首版验证记录（2026-10-22）

- `:nativeApp:assembleDebug` 成功生成 APK。
- `:nativeApp:testDebugUnitTest`：15 项通过（7 项连接/安全/不重放，8 项消息合并/分页/重试/会话切换）。
- `:nativeApp:connectedDebugAndroidTest`：Android 11 / API 30 模拟器上 1 个完整交互流程通过；覆盖连接、流式回复、审批允许/拒绝、活动会话切换、停止、旋转保留草稿、前后台重连、历史分页、断开后禁用发送。深色模式还检查实际渲染背景色，而非仅切配置。
- `:nativeApp:lintDebug`：`No issues found`。
- 旧模块 `:app:checkServerUrl`：26 passed, 0 failed。
- 环境：JDK 21、SDK Platform 35；离线 fixture 复用当前 Core 的真实 HTTP/WS/controller，不调用真实 provider。

### 工作台迁移验证记录（2026-10-23）

- DeepSeek V4.1 Flash（`cn:deepseek-v4.1-flash`）完成分工实现；主代理负责集成、审查和实际测试。
- `:nativeApp:assembleDebug`：成功，versionName `0.2.0` / versionCode `2`。
- `:nativeApp:testDebugUnitTest`：**25 项通过**（连接/安全 7、消息合并 8、工作台协议/图片/有界事实投影 10）。
- Android 11 / API 30，1080×2280、440dpi 手机配置：**5 项通过**，包含原聊天完整回归、工作台导航/主题/文件/模型/用量，以及 3 项真实 Core 状态操作集成。
- 同一模拟器覆盖 1600×1000、160dpi 宽屏配置：**4 项通过**，包括常驻侧栏/详情/设置、模型弹窗宽度约束、目录刷新不清选择、图片实际解码渲染和会话附件隔离。测试后恢复设备分辨率/密度。
- `:nativeApp:lintDebug`：**0 errors, 0 warnings**；仍有 4 条 primitive state 装箱优化的 informational 建议。
- `node tests/native-workbench-smoke.mjs`：通过，覆盖真实 Core HTTP/WS/controller、来源 CRUD、文件、checkpoint/MCP fixture 操作和真实 durable queue 的暂停/取消/显式恢复/不重放。
- 联调修复了连接按钮嵌套横向滚动造成的点击裁剪、模型刷新误清选择、宽屏弹窗越界约束、分区事实丢失与来源目录 loading/error 键不一致。
- 截图来自实际设备测试：`/sdcard/Download/forge-workbench-*.png`；本轮拉取到 `nativeApp/build/ui-review/phone/` 和 `wide/`（构建目录不入 Git）。
- 用量/回复/MCP/checkpoint 样例均来自隔离 fake，不代表真实模型、真实 MCP 进程或生产检查点恢复验证；没有连接真实供应商、没有读取真实 Forge 私密配置。

复现宽屏测试（执行后务必恢复）：

```sh
adb shell wm size 1600x1000
adb shell wm density 160
./gradlew :nativeApp:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=dev.forge.nativeapp.WorkbenchUiTest,dev.forge.nativeapp.WorkbenchIntegrationTest
adb shell wm size reset
adb shell wm density reset
```

### 10 MB 体积优化验证记录（2026-10-23）

- 最终干净构建的 Debug APK：**6,745,046 字节（6.75 MB / 6.43 MiB）**，相对之前的 11,666,424 字节缩小约 **42.2%**。这是保留调试与设备测试能力后的交付包，不是最激进裁剪的中间产物。
- Release 未签名 APK：**1,585,643 字节（1.59 MB）**；本轮只验证构建与体积，不声称 Release 已经过设备交互验收。
- 上限检查实际拒绝过超限产物；另以临时文件验证 **10,000,000 字节拒绝、9,999,999 字节接受**，验证后移除临时文件并确认正式 Debug APK 哈希未变。
- **25 项 JVM 测试、5 项 Android 11 手机设备交互测试通过**。最终精简 Debug 包覆盖流式聊天、审批允许/拒绝、停止、草稿/重连、分类设置/文件/模型/队列/图片和实际深浅色渲染；使用隔离离线 Core fixture。
- 最终 Debug 包通过 ZIP CRC、APK v2 签名检查，`adb install -r` 成功；清单包含 `application-debuggable`，冷启动成功，运行进程出现在 JDWP 列表且 `run-as` 成功。4 种原有 ABI 均保留。
- 本轮未重跑宽屏矩阵，也未做真实供应商、公网或真机验收；此前的宽屏记录不等于新裁剪包的宽屏验收。

## 尚未覆盖的产品范围

- 通用文件上传/下载、已发布文件保存、导出会话、语音、推送、后台常驻、离线历史库与离线发信队列（输入队列由在线 Core 持有，不是手机离线发信）。
- 完整 CommonMark、公式、代码语法高亮、HTML 预览；原生 Markdown 为有界安全子集。
- 多服务器档案管理、凭据持久化/Keystore、扫码配对、代理交互式登录。
- 模型账号 OAuth/设备码登录、多凭据路由/额度、导入预览/连通测试、复杂路由组编辑和模型选择模式编辑；路由组可选择但不能在本机编辑。
- MCP 远程 HTTP/SSE 注册、health 测试及私密环境变量/请求头管理；本机新增入口仅 stdio。
- 与桌面精确一致的全部键盘快捷键、完整读屏/200% 缩放/不同厂商设备矩阵。
- 不作为已签名正式分发包；当前交付为源码及 debug APK，不配置 release 密钥。
- 真实设备、不同厂商键盘、公网代理、设备鉴权撤销与真实模型端到端需要另行联调。
