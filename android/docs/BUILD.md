# 构建与验证边界

本文只描述 `android/` 内部，不涉及根 `package.json` / `pnpm-lock.yaml` / `src/`。

## 1. 环境要求

| 组件 | 版本 | 说明 |
| :--- | :--- | :--- |
| JDK | **17 或 21**（需要 `javac`） | AGP 8.7 要求 JDK 17+；**JDK 27 不可用**（AGP 尚未支持），且本机 `java-27-openjdk` 无 `javac` |
| Android SDK Platform | **33** | 未安装时可用 `sdkmanager` 补 `platforms;android-33` |
| Android SDK Build-Tools | 33.0.2 / 35.0.0 | 任一可用即可 |
| Gradle | **8.9** | 由仓库内 wrapper 固定；AGP 8.7.3 支持 8.9 |
| AGP | 8.7.3 | `build.gradle.kts` 中声明 |

SDK 位置只通过 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 或**本地** `android/local.properties` 提供：

```properties
# android/local.properties（已被 .gitignore 忽略，不要提交）
sdk.dir=/home/<user>/Android/Sdk
```

## 2. 可重复构建命令

```sh
cd android
export JAVA_HOME=/path/to/jdk-17-or-21
export ANDROID_HOME=/path/to/Android/Sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"

# 首次会下载 Gradle 8.9 与 Maven 依赖（google() / mavenCentral()）
./gradlew --no-daemon :app:assembleDebug

# 产物
ls -l app/build/outputs/apk/debug/app-debug.apk
```

安装到已连接设备（adb 可选，不属于构建）：

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

依赖只有两个，均由 Maven 解析，无源码内联、无本地 `libs/`：

- `androidx.appcompat:appcompat:1.6.1`
- `com.journeyapps:zxing-android-embedded:4.3.0`（传递依赖 `com.google.zxing:core:3.4.1`）

## 3. 本机实际验证记录

在本仓库当前环境上真实执行过：

| 检查 | 命令 | 结果 |
| :--- | :--- | :--- |
| URI 单元测试 | `./gradlew checkServerUrl` | **26 passed, 0 failed** |
| Debug APK 构建 | `./gradlew :app:assembleDebug` | **BUILD SUCCESSFUL**，产出 `app-debug.apk`（约 3.3 MB） |
| 产物清单 | `aapt2 dump badging` | `package=dev.forge.mobile.debug`，`minSdk 23`，`targetSdk 33`，含 `INTERNET`/`CAMERA` |
| 合并清单 | `aapt2 dump xmltree … AndroidManifest.xml` | `usesCleartextTraffic=true`；ZXing `CaptureActivity` 合并且 `exported=false` |

本机环境事实（中期观察，供主代理参考）：

- SDK：`/home/ling/Android/Sdk`，已装 `platforms/android-30`、`android-33`，`build-tools/30.0.3`、
  `33.0.2`、`35.0.0`，`cmdline-tools/latest`。**没有** `ANDROID_HOME` 等环境变量预置。
- JDK：系统只有 `/usr/lib/jvm/java-27-openjdk`（仅 `java`，无 `javac`，不可用于 AGP）。
- Gradle：系统未安装 `gradle`。
- 为完成本次构建，仅在 `/tmp` 临时取用 Temurin JDK 21 与 Gradle 8.9，**没有**全局安装 SDK/软件，
  也未修改任何全局配置；仓库只提交 wrapper 与源码。
- 因此：**在只装了 JDK 27 + 未装 Gradle 的机器上，直接 `./gradlew` 会阻塞**；
  需要先提供 JDK 17/21（见上表）后才能重复构建。

## 4. 未验证项（重要，勿当作已验证）

以下**没有**真机/模拟器验证，只做过静态审阅与构建：

1. **真机运行**：本次未启动模拟器也没有连接设备，App 未实际启动过。
2. **扫码链路**：相机权限、ZXing `CaptureActivity` 旋转/取景、二维码解码未实测。
3. **WebView localStorage**：现代 WebView 下 `localStorage` 可用的假设未实测；
   旧 System WebView 可能仍需额外开关。
4. **`setAllowContentAccess(true)` 与上传**：系统选择器返回 `content://` URI 后，
   WebView 能否稳定读取用于 `<input type=file>` 上传，平台行为依 WebView 版本而异，**需真机确认**。
   这是安全与功能的折中：为上传保留 content 读取，同时用 `handleNavigation()` 拦截非 http(s) 顶层导航。
5. **图片选择**：未验证多选、HEIC、大图等边界。
6. **返回键 / 旋转恢复**：`onSaveInstanceState` + `restoreState` 未实测；`configChanges` 已声明但未跑过旋转。
7. **IPv6**：`http://[::1]:5173/` 只通过 URI 单元测试，未在局域网真机验证可达性。
8. **HTTPS**：未验证自签证书（预期会被默认 TLS 行为拒绝，这是有意设计）。
9. **Chrome 132 兼容**：Web UI 需要较新的 Android System WebView；未在旧 WebView 上做过兼容性测试。
10. **lint**：`abortOnError = true` 已配置；本次构建未跑 `./gradlew lint`。
11. **release 构建**：未构建，也未配置签名；debug 是当前唯一支持的构建。

## 5. 安全取舍说明

- 无 `addJavascriptInterface()`：网页不能调用原生代码。
- 无 `onReceivedSslError()` 重写：证书错误不被忽略。
- 地址只允许 `http(s)`，拒绝凭据 URL 与其余 scheme。
- 最近地址仅保存 URL，不保存任何令牌/cookie。
- `android:allowBackup="false"`，避免 WebView 本地存储被系统备份带走。
- `android:usesCleartextTraffic="true"` 允许局域网 HTTP，不提供传输加密；HTTPS 页面的混合内容仍由 `MIXED_CONTENT_NEVER_ALLOW` 拒绝。本轮不增加 TLS 或账号系统。
