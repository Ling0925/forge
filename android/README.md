# Forge Android

本目录包含两个可以并存安装的应用：

| 模块 | 技术 | 定位 |
| --- | --- | --- |
| **`:nativeApp`** | **Kotlin + Jetpack Compose / Material 3** | 新版原生聊天客户端，直接接入 forge-core 的 HTTP RPC + WebSocket，不依赖 Web UI |
| `:app` | Java + Android WebView | 原有兼容客户端，继续复用服务器 Web 工作台，原有功能保留 |

## 新版：Forge Native

以聊天为中心：会话搜索与切换、历史分页、流式回复、思考/工具折叠、常见 Markdown 与代码复制、按服务器/会话保存草稿、模型选择、停止运行、逐次工具审批、前后台恢复与断线重连。默认只读，工作区操作需显式选择；网络失败不自动重发消息。

```sh
# JDK 17/21 + Android SDK 35；ANDROID_HOME 指向本机 SDK
./gradlew :nativeApp:assembleDebug :nativeApp:testDebugUnitTest
adb install -r nativeApp/build/outputs/apk/debug/nativeApp-debug.apk
```

- 应用名 **Forge Native**，debug 包名 `dev.forge.nativeapp.debug`，Android 8.0+。
- 连接 Core 服务地址即可；原生应用不加载网页，也不在手机上运行 Node/Core。
- 可选设备 Bearer 凭据 / 一次性配对码，仅保存在本次进程内，不保存模型密钥。
- 公网接入需安全部署；HTTP 只适用于可信局域网，不忽略 TLS 错误。
- 架构、接入、协议与当前限制见 **[docs/NATIVE_ANDROID.md](docs/NATIVE_ANDROID.md)**。
- 离线真实 Core 联调与模拟器测试见 **[docs/NATIVE_FIXTURE.md](docs/NATIVE_FIXTURE.md)**。

---

## 旧版：Forge Mobile（以下内容仅描述 `:app`）

一个**独立**的 Android 客户端，用 Java + Android `WebView` 复用服务器上的 Web 工作台。

手机端**不包含**任何核心逻辑：会话、任务、工具、审批、断线重连全部留在服务器。App 只做三件事：

1. 扫码或手输服务器地址；
2. 用 `WebView` 加载该地址的 Web UI，遇到内网穿透／反向代理的 HTTP 认证时弹出原生账号密码框；
3. 把系统图片选择器接进来，并处理好返回键。

> 没有账号系统、没有令牌交换、没有自定义 TLS、没有 Capacitor/Cordova、没有 JavaScript bridge。

---

## 目录结构

```
android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
├── gradlew / gradlew.bat / gradle/wrapper/     # Gradle 8.9 wrapper（可重复构建）
├── .gitignore                                  # 忽略 .gradle/ build/ local.properties 等
├── docs/BUILD.md                               # 构建、环境与验证边界
├── tests/ServerUrlTest.java                    # 纯 JDK 的 URI 规范化测试
└── app/
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/dev/forge/mobile/
        │   ├── MainActivity.java               # 首页：扫码 / 手输 / 最近地址
        │   ├── WebAppActivity.java             # 唯一的 WebView 壳
        │   ├── ServerUrl.java                  # 地址校验与规范化（无 Android 依赖）
        │   └── RecentServers.java              # 最近地址（只存 URL）
        └── res/…                               # 简单原生 UI（无第三方 UI 框架）
```

---

## 行为约定

### 首页（`MainActivity`）

- **扫码连接**：使用成熟库 [ZXing Android Embedded](https://github.com/journeyapps/zxing-android-embedded)
  (`com.journeyapps:zxing-android-embedded:4.3.0`，Maven 依赖，非源码内联)。
- **手输地址**：输入框 + 连接按钮，键盘 `Go/Done` 亦可提交。
- **最近地址**：最多 8 条，只保存 URL 字符串，可一键清空或点选重连。
- 二维码内容按**普通根 URL** 处理，例如 `http://192.168.1.2:5173/`。
  服务器将来若返回带类型的 JSON，客户端首版**不解析**，会按普通 URL 校验失败并提示。

### 地址校验（`ServerUrl`）

| 输入 | 结果 |
| :--- | :--- |
| `http://192.168.1.2:5173/` | 通过 |
| `192.168.1.2:5173` | 通过，补成 `http://192.168.1.2:5173/` |
| `https://forge.example.com/workbench` | 通过 |
| `http://[::1]:5173/` | 通过（IPv6 见“未验证项”） |
| `javascript:…` / `intent://…` / `file://…` / `content://…` / `data:…` / `ftp://…` | **拒绝** |
| `http://user:pass@host/` | **拒绝**（不静默保存/重放凭据） |
| `http://host:abc/`、`http://host:99999/`、含空白 | **拒绝** |

- 只允许 `http` / `https`；协议之外的 scheme 直接拒绝，不会被“顺手改成 http”。
- 端口必须是 `1..65535`；路径/查询里的 `:` 不会被误判为端口。
- 裸 IPv6（`::1`）会被补上方括号；带方括号的 host 不会出现双层括号。

### WebView 壳（`WebAppActivity`）

- 开启 **JS**、**DOM storage**（`setDomStorageEnabled` + `setDatabaseEnabled`）。
- `usesCleartextTraffic="true"`：允许局域网 HTTP。
- **不添加** `addJavascriptInterface()`：网页无法调用任何原生方法。
- **不重写** `onReceivedSslError()`：TLS 错误保持 WebView 默认行为（拒绝加载）。
- `setAllowFileAccess(false)`；`setAllowContentAccess(true)` 仅为让系统选择器返回的
  `content://` URI 能被上传读取；`file://`/`javascript:` 等顶层导航一律拦截。
- 顶层导航只允许 `http(s)`；子 frame 额外放行 `about:`、`blob:`、`data:`
  （iframe 与内联预览需要），拦截时不再弹 Toast（WebView 内部也会走该回调）。
- 图片选择：`onShowFileChooser` → `Intent.createChooser` 系统 chooser，
  **不申请存储权限**、不内置图库；取消/无选择时回传 `null`。
- `onShowFileChooser` 需要 API 21+，`WebChromeClient.FileChooserParams` 已在 API 21 引入。
- 返回键：先用 `canGoBack()` 回退，再退出到首页（最近地址保留）。
- 工作台不显示原生顶部导航栏或地址栏，WebView 填满应用内容区（保留系统状态栏和底部导航）。
- 系统栏跟随网页实际顶部／底部背景色，采用 280ms 标准贝塞尔曲线平滑插值过渡，图标根据实时亮度在临界点无缝切换黑白对比度，避免生硬跳变与闪烁；滚动、跳转与主题切换时防抖即时响应（前台保底 500ms 轮询），切到后台停止读取。状态栏下方配备平滑流光加载指示条，加载完成优雅渐隐。实现只执行内置只读颜色采样脚本，接受两个严格 RGB 色值与一个深浅标志，不增加 JS 原生桥、不读取页面内容或存储。首次打开按系统主题，之后用上次主题作为加载背景；连接设置／错误面板也有浅深色资源。WebView 的系统主题媒体查询仍保持跟随 OS，不被缓存的主题强制覆盖。Android 6/7 无深色导航键时底栏保留深色以确保可见。
- Android 在 **设置 → 服务器连接 → 编辑或更换连接** 管理连接：打开本地连接设置，预填当前地址，可修改地址、扫码或选择最近连接，点击“连接”才应用；取消或返回保留原工作台，不取消服务器任务。切换后清除旧页面历史，连接地址随 Activity 状态保存。
- Android 7+ 的 WebView 使用 `ForgeMobile/1` UA 标记展示该设置分类（只用于 UI 能力识别，不是鉴权）。原生只拦截用户点击、主框架、与所选服务器及当前页面同源的固定 `/.forge-mobile/connection-settings` 路径，不接受查询参数或片段，不提供 JS 原生桥。Android 6 的旧导航回调缺少手势/框架信息，不展示此网页入口且拒绝原生动作；仍可返回首页或从错误面板进入本地设置。
- 加载失败时提供“重试”和进入同一个本地“连接设置”的恢复入口，服务器不可达时仍能编辑地址。普通浏览器/桌面保留原有“手机连接”配对功能。
- 新入口同时需要新版 APK 和服务端新版界面；开发 Web 使用 HMR，静态部署需重新执行 `pnpm build:web`。
- 断网期间任务仍由服务器持有，Web UI 自己重连；客户端不实现重连状态机。
- 用量看板、设置等延迟加载面板出错后可直接“重试”，或返回工作台后重新打开；不会一直复用失败状态。重试会重新加载失败的脚本／样式，不刷新整个工作台，保留会话草稿；正常关闭再打开仍保留面板的筛选／设置草稿。旧资源因服务更新而失效时，可点错误页的“刷新页面”获取新版入口，不依赖 WebView 地址栏。此修复在共享 Web UI，重新构建服务端 Web 并重开工作台即可，无需更新 APK。
- 下载不做处理（提示到桌面端完成），避免把服务器产物落到手机。

### 内网穿透的 HTTP 账号密码

- 填写或扫描不含账号密码的穿透网址（公网建议 `https://`）。收到标准 HTTP 认证挑战时，App 会显示 **HTTP 身份验证** 弹窗，注明请求认证的服务器；填写穿透服务／反向代理设置的用户名和密码后点击 **登录**。
- 这不是 Forge 账号系统。密码输入会遮挡，App 不将账号密码放入 URL、最近连接、配置或 Activity 保存状态，也不写入 WebView 的持久 HTTP 密码库。WebView 自行管理认证缓存，进程重启后可能需要重新输入。
- 密码错误时再次提示输入，不自动重复提交旧密码；取消后可通过 **重试** 重新认证，也可进入 **连接设置** 更换地址。切换页面／连接和退出工作台时会取消未完成的认证请求。
- 使用 WebView 的标准认证处理，不自行向所有请求注入 `Authorization`，不绕过 HTTPS 证书错误。没有标准认证挑战的 HTTP 401 显示重试提示；第三方网页登录、验证码等不属于此适配。
- 更新 APK 即可使用，不需要更新 Forge 服务端。本次认证适配已编译 debug APK，按用户要求未做认证功能的真机／模拟器联调。

### 已明确不做

- Forge 账号系统／令牌、TLS 自定义（含“忽略证书错误”开关）；
- 任意网页可调用的 JS bridge；
- 把 core/会话逻辑移植到手机，或内嵌 Node/前端资源；
- 引入客户端专用的 core 或服务端 API；连接设置入口仅复用共享 renderer。

---

## 构建

完整环境要求、可重复命令与阻塞说明见 **[docs/BUILD.md](docs/BUILD.md)**。最小用法：

```sh
cd android
export ANDROID_HOME=/path/to/Android/Sdk      # 或写 local.properties（已被忽略）
./gradlew :app:assembleDebug
./gradlew checkServerUrl                      # 纯 JVM 的 URI 校验，不需要设备
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`（**不入 git**，已被 `android/.gitignore` 忽略）。

---

## 版本与兼容性

- `minSdk 23`、`targetSdk 33`、`compileSdk 33`（本机 SDK 现成可用的最高平台）。
- Web UI 的构建目标是 **Chrome 132**，因此手机上需要**较新的 Android System WebView**
  （建议 Chromium ≥ 132；Android 10+ 通常可在应用商店更新）。WebView 过旧时页面可能空白或
  JS 报错，此时先更新 System WebView 再重试。
- 建议在 Android 10 及以上、WebView 已更新的设备上使用。
