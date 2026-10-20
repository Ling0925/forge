# 让子代理在独立 worktree 中改文件

给 `spawn_agent` 加上 `isolation: "worktree"` 即可，不增加审批步骤：

```json
{
  "task": "修复解析器并补充测试",
  "isolation": "worktree",
  "writePaths": ["src/parser", "tests/parser"]
}
```

Forge 从父仓库**已提交的 HEAD** 创建 detached worktree，并为子代理重新构造文件工具和项目上下文。位置为 `${FORGE_HOME}-worktrees/<子会话 ID>`，默认是 `~/.local/share/forge-worktrees/`。它位于私有状态目录旁，文件工具无需访问凭据和会话目录。父工作区是仓库子目录时，子代理仍进入相同的相对子目录。

`spawn_agent` 返回 `workspace` 和 `isolation`。`get_agent_result`、`wait_agents` 和历史结果还提供 `worktree` 元数据，包括目录和 `baseRevision`。

不传 `isolation` 时仍共享父工作区。父工作区的未提交改动不会复制到新 worktree；需要共享这些改动时，用默认共享模式，或先提交所需代码。只读模式不创建 worktree。工作树分开了文件修改，但不是操作系统沙箱。

## 检查和合入结果

子代理结束、失败或取消后，worktree 和其中的未提交文件都会保留。Forge 不自动提交、合并或删除它们。

```sh
git -C /path/to/parent worktree list
git -C /path/to/child status
git -C /path/to/child diff
```

检查后，可在子工作树提交需要的文件，再把该提交合入父仓库：

```sh
git -C /path/to/child add src/parser tests/parser
git -C /path/to/child commit -m "fix: handle parser edge case"
git -C /path/to/parent cherry-pick <子工作树提交>
```

确定结果已保存且不再需要工作树时：

```sh
git -C /path/to/parent worktree remove /path/to/child
```

非 Git 工作区或没有提交的仓库不能创建 worktree。创建失败时，错误会给出可能残留的目录；先检查该目录，不会自动覆盖或重建。
