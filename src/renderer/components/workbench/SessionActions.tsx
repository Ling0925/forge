import { DotsThreeVertical } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { OperationScope } from "../../state/operation-scope";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";
import { Dialog } from "./Dialog";

export function SessionActions() {
  const { state, selectSession, loadSessions, refreshActiveSession } =
    useWorkbench();
  const snapshot = state.activeSnapshot;
  const scope = useRef(new OperationScope());
  useEffect(() => {
    scope.current = new OperationScope();
    return () => scope.current.close();
  }, []);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState("");
  if (!snapshot) return null;
  const run = state.activeRuns[snapshot.id];
  const locked =
    busy || run?.status === "running" || run?.status === "awaiting_approval";
  const action = async (operation: (valid: () => boolean) => Promise<void>) => {
    const valid = scope.current.begin();
    setBusy(true);
    setError("");
    try {
      await operation(valid);
      if (!valid()) return;
      await loadSessions();
      await refreshActiveSession();
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      if (valid()) setBusy(false);
    }
  };
  const exportSession = async () => {
    const valid = scope.current.begin();
    setBusy(true);
    setError("");
    setExportState("等待保存对话框…");
    try {
      const saved = await window.forge.exportSession(snapshot.id);
      if (valid())
        setExportState(saved ? "已保存 JSON 文件" : "已取消导出，未保存文件");
    } catch (err) {
      if (valid()) {
        setExportState("");
        setError(err instanceof Error ? err.message : "导出失败");
      }
    } finally {
      if (valid()) setBusy(false);
    }
  };
  // Presentation change only: the former full-width action bar is now a quiet
  // overflow/disclosure in the task header. Every command, its lock/busy state
  // and the rename dialog behavior are unchanged.
  return (
    <section
      className="session-actions wb-session-actions"
      aria-label="会话操作"
    >
      <details className="wb-overflow">
        <summary
          className="wb-icon-btn"
          aria-label="会话操作"
          title={locked ? "会话操作（运行中暂不可用）" : "会话操作"}
        >
          <DotsThreeVertical size={16} weight="bold" />
          {renaming && <span className="wb-dirty-dot" aria-hidden="true" />}
        </summary>
        <fieldset
          className="wb-overflow-panel wb-stack"
          aria-label="会话操作菜单"
        >
          <Button
            size="sm"
            className="wb-menu-item"
            disabled={locked}
            onClick={() => {
              setTitle(snapshot.title);
              setRenaming(true);
            }}
          >
            重命名
          </Button>
          <Button
            size="sm"
            className={`wb-menu-item${snapshot.archived ? "" : " is-danger"}`}
            disabled={locked}
            onClick={() =>
              void action(async () => {
                await window.forge.archiveSession(
                  snapshot.id,
                  !snapshot.archived,
                );
              })
            }
          >
            {snapshot.archived ? "取消归档" : "归档"}
          </Button>
          <Button
            size="sm"
            className="wb-menu-item"
            disabled={locked}
            onClick={() =>
              void action(async (valid) => {
                const fork = await window.forge.forkSession(snapshot.id);
                if (valid()) await selectSession(fork.id);
              })
            }
          >
            分叉会话
          </Button>
          <Button
            size="sm"
            className="wb-menu-item"
            disabled={busy}
            onClick={() => void exportSession()}
          >
            导出 JSON
          </Button>
        </fieldset>
      </details>
      {exportState && <output className="wb-inline-note">{exportState}</output>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {renaming && (
        <Dialog title="重命名会话" onClose={() => setRenaming(false)}>
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async (valid) => {
                await window.forge.renameSession(snapshot.id, title.trim());
                if (valid()) setRenaming(false);
              });
            }}
          >
            <Input
              aria-label="会话标题"
              value={title}
              maxLength={256}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button type="submit" disabled={busy || !title.trim()}>
              保存标题
            </Button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
