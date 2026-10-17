# 桌面 Slash 命令

桌面与 CLI 使用同一份 `src/shared/slash-commands.ts` 命令表、参数说明、过滤及空白分词解析。会话与资源操作共用 `src/shared/slash-actions.ts`，桌面通过现有 ForgeBridge 调用，不向模型发送命令文本。

输入 `/` 查看全部 CLI 命令；↑/↓ 选择，Tab 补全，Enter 执行，Esc 收起并保留草稿。参数按空白切分，与 CLI 一样不支持 shell 引号分组。输入法确认候选不会执行命令。

## 已接入的命令

- `/model [id]`、`/reasoning [default|none|minimal|low|medium|high|xhigh]`：无参数打开模型/思考强度面板，有参数直接设置；思考强度保存到全局配置。
- `/mode [plan|build]`、`/permission [readonly|workspace|unrestricted]`：无参数显示当前值，有参数修改下一次运行的配置。Plan 运行仍强制只读。
- `/new`：立即创建并切换会话，沿用当前工作区和所选模型，不再只是打开新会话页面。
- `/sessions`、`/resume [uuid]`：显示可选择的会话列表，或按完整 ID 恢复。
- `/fork [boundary]`、`/rename <title>`、`/archive`、`/compact`：调用同一套会话操作。
- `/plan`、`/diagnostics`、`/context`、`/skills`、`/export`：显示计划、统计、上下文、技能或会话 JSON。桌面继续使用脱敏 DTO，不扩展敏感数据访问。
- `/checkpoints [list|diff ID|restore ID]`、`/mcp list|register|enable|disable|remove|health`：复用 CLI 操作与参数分发。注册格式为 `/mcp register ID LABEL COMMAND [ARGS...]`。
- `/help`：列出同一套完整命令及桌面能力限制。

## 尚未接入桌面的能力（保留在列表中并明确提示）

- `/history`、`/approval`：CLI 进程内历史与自动审批策略，不冒充桌面草稿或更改桌面审批规则。
- `/steer`、`/queue`、`/tasks`：当前桌面桥接未提供插话、待发队列和进程任务控制接口。
- `/tools`、`/thinking`：CLI 工具编号和思考流展示控制尚未接入；桌面现有工具卡/思考折叠区不被当作同义命令。
- `/quit`、`/exit`：CLI 退出进程；桌面仍通过关闭窗口退出。

当前运行中的桌面会话只允许 `/help` 或查看能力限制，其余命令明确提示等待/停止运行后再执行，不自动排队、重放或作用于随后切换的会话。异步命令执行期间阻止重复执行与发送；失败保留输入。桌面压缩通过已有 RPC 执行，尚不支持 CLI 的 Ctrl+C 中断压缩。

已移除上一版自行增加的 `/settings`、`/stop` 和 `//` 转义。与 CLI 相同，首字符为 `/` 才识别为命令；发送以 `/` 开头的普通内容可在前面加空格。

## 构建

共享 CLI 修改后执行 `node scripts/build-core.mjs`；桌面前端执行 `pnpm exec vite build`。使用仓库 `dist` 的桌面窗口需重新加载，CLI 需重启；不重新打包/安装，不修改启动器，旧发布包不会自动更新。
