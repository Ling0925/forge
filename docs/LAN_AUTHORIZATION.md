# LAN 设备授权

默认 Web/LAN 入口要求设备授权。只打开地址、知道二维码或取得页面 `clientId` 不能调用核心。继续本地直连，不引入云账号、中继或穿透。

## 本机配对与撤销

在**运行该宿主的电脑**使用相同的 `FORGE_HOME`（默认 `~/.local/share/forge`）：

```sh
forge devices pair 'My browser'
forge devices list
forge devices revoke DEVICE_ID
```

`pair` 输出 JSON，包含单次使用的 `token` 和 `expiresAt`，有效期五分钟。不要将输出贴入会话、提交 Git、日志或 URL。`list` 只显示设备 ID、名称、宿主范围、创建时间及撤销状态，没有凭证。CLI 不构造 Harness，不需要配置模型。每个状态目录最多保留 128 条设备记录（包括已撤销记录），最多 16 个未过期邀请；达到上限明确拒绝，不能靠删除状态恢复旧凭证。

在目标浏览器先打开**构建后的**服务地址，然后在该 origin 的开发者控制台执行以下一次性交换。将 token 输入弹框，不写在脚本或地址栏中：

```js
await fetch('/api/pair', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: prompt('One-time Forge pairing token') })
}).then(response => { if (!response.ok) throw new Error('Pairing failed'); });
location.reload();
```

该请求由浏览器自动带同源 Origin；成功后写入 HttpOnly、SameSite=Strict cookie。构建页面可公开加载，但配对前不能获取会话或调用核心。交换响应也提供一次性的设备凭证给自定义客户端；自定义客户端可使用 `Authorization: Bearer …`，每次 HTTP/WS 请求都应携带。不要同时发送 Bearer 与设备 cookie。凭证不是页面 ID；每个页面另行 `POST /api/connect`，重连使用自己的 clientId 和事件游标。禁止将凭证放入 URL。

开发服务器默认也要求授权，并在授权前阻止 Vite 源码 fallback。可以从同一 origin 的拒绝页面控制台完成交换后刷新。Vite HMR 仍是独立的开发连接及 token 边界；不要把开发服务器暴露给不可信网络。

当前 Android 地址扫码流程不会交换 token，浏览器的 cookie 也不会自动共享给 Android WebView。本项未增加手机配对 UI：自定义客户端可实现上面的核心接口；现有 Android 客户端如暂不能设置授权，只能由宿主明确选择下面的可信 LAN 兼容模式。不要将仅扫码到地址描述为已完成设备授权。

## 明确的兼容模式

- 独立 Web / dev：启动时添加 `--trusted-lan`，例如 `pnpm serve:web --host 192.168.1.2 --port 5173 --workspace /project --trusted-lan`。
- 桌面共享 LAN：在启动桌面进程前显式设置 `FORGE_TRUSTED_LAN=1`。仅精确的 `1` 启用；网页和 LAN 控制请求不能打开这个开关。
- 该模式跳过设备授权，所有能够访问地址的人都能操作工作台。只用于完全信任且自行限制可达性的网络。它不改变本机 Electron IPC / 私有 Unix socket 的身份和目录权限边界；本地连接不需要 LAN 凭证。
- 切换模式需重启相应宿主，先处理活动任务。兼容模式不删除已有授权记录；恢复默认模式后，撤销记录仍有效。

## 范围、存储和生命周期

授权范围是**同一个 FORGE_HOME 的整个宿主**，并非单会话、单页面或只读角色。独立 Web 的工作区 RPC 限制继续有效，桌面/dev 多工作区模式仍按其原规则工作；工具权限、审批、文件路径/符号链接及附件所属会话检查不被设备授权绕过。授权设备能配置 Provider/MCP、发起任务和处理审批，因此只给信任的设备。

私密状态位于 `devices/authorizations.json`（目录 0700、文件 0600），只保存域分离 SHA-256 摘要及公开元数据。随机凭证有 256 位秘密部分；配对交换在文件锁内原子消费，重启不能重复兑换。所有受保护 HTTP、WS 事件、附件和预览入口核验当前授权；损坏/缺失状态失败关闭。错误和一般事件不包含凭证。

本进程撤销等待活动连接关闭；独立 CLI 撤销通过文件变更提示关闭其他进程中的连接，漏掉提示时最多一秒的空闲检查兜底。新请求和每批事件仍直接读取权威状态，不依赖这个计时器或正向缓存。已经交给网络的旧数据无法收回。

撤销、页面断连或停止 LAN 监听**不取消已被核心接受的任务**。`web.close()` 只关监听；核心所有者的 `dispose()` / 进程退出才结束其运行。需要停止任务时使用运行控制的 `cancelRun` 并设置 `wait: true`，等待收敛；不会因为失去设备连接自动批准、重放或取消操作。

## HTTP 的限制

授权不是传输加密。普通 HTTP 的配对 token、设备 cookie、会话和文件可被同网监听者看到；cookie 因 HTTP 不设置 Secure，并按主机而非端口隔离。不要在同主机运行不可信服务，不要端口转发到公网，也不要把本功能当成已解决网络监听。用户仍自行控制网络可达性和可信网络范围。Host/Origin、JSON POST、请求大小、文件与工作区边界继续保留。
