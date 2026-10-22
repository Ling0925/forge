# Forge Native：Kotlin 原生聊天客户端

## 定位

`nativeApp/` 是独立的 Android 应用，不是 WebView 换皮。新应用使用 Kotlin、Jetpack Compose、Material 3；原来的 Java/WebView `app/` 保留，两个 debug 包可以并存安装。

- `dev.forge.nativeapp.debug` / **Forge Native**：新版聊天客户端。
- `dev.forge.mobile.debug` / Forge Mobile：原有 Web 工作台兼容客户端。

手机只负责交互、临时消息投影与连接。模型接入、会话持久化、工作区、工具执行、审批权限、运行生命周期继续由远端 Core 持有。关闭 App、切后台、断开连接都不发送取消；只有点“停止”才发 `cancelRun`。停止 Core 服务本身的行为由 Core 决定。

## 首版功能

- 聊天主界面、会话抽屉与标题搜索、新建对话、按回合加载更早消息。
- WebSocket 流式助手回复；思考与正文分离、工具结果折叠。
- 文本选择/复制，常见 Markdown（标题、列表、粗体、行内代码、围栏代码）和代码块复制。
- 多行输入、系统深浅主题、键盘/系统栏 insets、回到最新消息；向上阅读时不强制拉回。
- 草稿按 **服务器地址 + 会话 ID** 隔离，存入应用私有 SharedPreferences；旋转保留 ViewModel。
- 模型选择读取 Core 的实际 `listModels`，留空使用服务器/会话默认值；不虚构可用模型。
- 默认 `readonly` + `plan`；显式选择 `workspace` + `build`，显示工具审批的描述、命令和“允许这一次/拒绝”。不提供 unrestricted 开关，不自动批准。
- 停止生成、前后台恢复、连接失效后重新握手、读取远端活动运行/待审批状态。
- Bearer 设备凭据，或一次性配对码换取凭据；全部仅保留在本次进程内。
- HTTP/WS 发送、创建、取消和审批均不自动重试。结果不确定时保留草稿并锁住后续写操作，要求用户先刷新检查、再明确解锁。

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

只有 WebSocket 首批事件就绪且状态同步成功后才允许发送。HTTP 请求关闭 OkHttp 自动连接重试，RPC 校验 id/method；错误不会自动生成新的请求 ID 重放副作用。

## 代码结构

```text
nativeApp/src/main/java/dev/forge/nativeapp/
├── MainActivity.kt       # 生命周期、edge-to-edge、Compose 入口
├── ChatModels.kt         # 明确的 UI 状态与动作契约
├── CoreTransport.kt      # HTTP RPC、鉴权、WS 批次与 ACK、安全地址解析
├── ChatViewModel.kt      # 状态、重连、分页、草稿、运行和审批协调
├── Transcript.kt         # 绝对消息位置 + generationId 合并快照/流，防重复
└── ui/
    ├── ForgeTheme.kt     # Forge 中性色/翡翠绿、系统深浅主题
    ├── ForgeScreen.kt    # 原生聊天、连接、会话与审批界面
    └── MessageContent.kt # 不执行 HTML 的文本 Markdown 子集
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

### 本次验证记录（2026-10-22）

- `:nativeApp:assembleDebug` 成功生成 APK。
- `:nativeApp:testDebugUnitTest`：15 项通过（7 项连接/安全/不重放，8 项消息合并/分页/重试/会话切换）。
- `:nativeApp:connectedDebugAndroidTest`：Android 11 / API 30 模拟器上 1 个完整交互流程通过；覆盖连接、流式回复、审批允许/拒绝、活动会话切换、停止、旋转保留草稿、前后台重连、历史分页、断开后禁用发送。深色模式还检查实际渲染背景色，而非仅切配置。
- `:nativeApp:lintDebug`：`No issues found`。
- 旧模块 `:app:checkServerUrl`：26 passed, 0 failed。
- 环境：JDK 21、SDK Platform 35；离线 fixture 复用当前 Core 的真实 HTTP/WS/controller，不调用真实 provider。

## 尚未覆盖的产品范围

- 图片/文件上传、下载、语音、推送通知、后台常驻、离线历史库与离线发信队列。
- 目前只显示历史消息的图片数量，不加载图片内容。
- 完整 CommonMark、复杂表格/公式、代码语法高亮、可点击网页链接、HTML 预览。
- 多服务器档案管理、凭据持久化/Keystore、扫码配对、代理交互式登录。
- 修改 Core 模型供应商配置、MCP 管理、工作区文件浏览/差异/检查点等桌面完整功能。
- 不作为已签名正式分发包；当前交付为源码及 debug APK，不配置 release 密钥。
- 真实设备、不同厂商键盘、公网代理、设备鉴权撤销与真实模型端到端需要另行联调。
