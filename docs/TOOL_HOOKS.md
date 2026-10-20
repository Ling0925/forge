# 按需配置工具生命周期 hooks

默认没有 hooks，也不会启动额外进程。需要执行自定义检查或记录时，把配置交给本机 CLI：

```sh
forge hooks set /path/to/hooks.json
forge hooks show
forge hooks clear
```

配置保存在私有的 `$FORGE_HOME/tool-hooks.json`，下次运行生效；不从工作区、AGENTS.md 或会话内容自动加载。未填写的事件列表默认为空。

## 一个最小配置

```json
{
  "beforeTool": [
    {
      "id": "check",
      "command": "/absolute/path/to/check-tool",
      "tools": ["run_command"]
    }
  ]
}
```

每项使用 `command` 和可选 `args` 数组，无隐式 shell；工作目录是当前会话的工作区。省略 `tools` 时匹配所有工具。还可设置 `timeoutMs`（默认 5000，范围 100–30000）和 `maxOutputBytes`（默认 8192，范围 256–65536）。`runEnd` 不按工具名过滤。

## 事件顺序和结果

- `beforeTool`：执行前调用。退出码 0、空 stdout 或 `{"decision":"allow"}` 表示继续；`{"decision":"deny"}` 表示拒绝。非零退出、超时、格式错误也阻止这次工具执行。
- `afterTool`：工具成功后调用。
- `toolError`：工具失败、抛错或被 beforeTool 拒绝后调用；同一次调用不会同时触发 afterTool。
- `runEnd`：本轮收尾时调用一次，包含运行状态和步数。

同类 hooks 按配置顺序执行。观察类 hook 失败不会覆盖已完成工具的结果，也不会重放工具；诊断会写入会话并显示，最终运行状态标为失败。runEnd 的成功只表示该脚本成功退出，任务是否完成仍需查看实际结果。

Hooks 不增加确认弹窗，也不能改变现有工具权限。只读模式会跳过可执行 hooks，并记录 skipped；普通只读工具继续运行。配置了工具级 hooks 时，工具调用保持串行，避免脚本副作用与并发读取交错；仅配置 runEnd 不影响只读并发。

## 脚本从 stdin 读取 JSON

```json
{
  "version": 1,
  "hook": "beforeTool",
  "session": {
    "sessionId": "...",
    "workspace": "/path/to/workspace",
    "permission": "workspace"
  },
  "tool": {
    "name": "run_command",
    "callId": "call-1",
    "arguments": "{\"argv\":[\"git\",\"status\"],\"timeout_ms\":10000}",
    "argumentsTruncated": false
  }
}
```

afterTool 和 toolError 另有 `outcome`，包括 `isError`、`contentBytes`、`contentPreview`、`previewTruncated`、`changeCount`。runEnd 使用 `run: {status, toolCalls, steps}`，没有 tool。

工具参数最多传入 16 KiB，结果预览最多 4 KiB，超出时标记截断。不会发送完整会话或供应商配置。进程只继承基本执行环境；需要 shell 时由你显式配置 shell 可执行文件和参数。

会话中的 `tool_hook` 诊断只包含 hook ID、事件、状态、退出码、耗时及输出字节数，不记录原始 stdout/stderr 或脚本提供的拒绝原因。取消和超时会清理进程；Linux 上同时清理其进程组。
