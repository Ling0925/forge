import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckpointDto } from "../../../shared/ipc";
import { OperationScope } from "../../state/operation-scope";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { CodeBlock } from "../primitives/CodeBlock";
import { Dialog } from "./Dialog";

export function CheckpointPanel() {
  const { state, refreshActiveSession } = useWorkbench();
  const id = state.activeSessionId;
  const scope = useRef(new OperationScope());
  useEffect(() => {
    scope.current = new OperationScope();
    return () => scope.current.close();
  }, []);
  const [checkpoints, setCheckpoints] = useState<readonly CheckpointDto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CheckpointDto | null>(null);
  const [diff, setDiff] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const report = useCallback(
    (err: unknown) => setError(err instanceof Error ? err.message : "操作失败"),
    [],
  );
  useEffect(() => {
    let alive = true;
    setCheckpoints([]);
    setSelected(null);
    setDiff("");
    setError("");
    if (id) {
      void window.forge
        .listCheckpoints(id)
        .then((value) => {
          if (alive) setCheckpoints(value);
        })
        .catch((err) => {
          if (alive) report(err);
        });
    }
    return () => {
      alive = false;
    };
  }, [id, report]);
  const action = async (operation: (valid: () => boolean) => Promise<void>) => {
    const valid = scope.current.begin();
    setBusy(true);
    setError("");
    try {
      await operation(valid);
    } catch (err) {
      if (valid()) report(err);
    } finally {
      if (valid()) setBusy(false);
    }
  };
  const running =
    id &&
    (state.activeRuns[id]?.status === "running" ||
      state.activeRuns[id]?.status === "awaiting_approval" ||
      state.activeSnapshot?.status === "running" ||
      state.activeSnapshot?.status === "awaiting_approval");
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <section className="wb-stack">
        <h3>文件检查点</h3>
        <p className="wb-muted">
          只恢复选中的文件检查点，不执行 git reset。命令副作用不在备份范围内。
        </p>
        <Button
          size="sm"
          disabled={!id || busy}
          onClick={() =>
            void action(async (valid) => {
              if (!id) return;
              const value = await window.forge.listCheckpoints(id);
              if (valid()) setCheckpoints(value);
            })
          }
        >
          刷新检查点
        </Button>
        {checkpoints.map((checkpoint) => (
          <article key={checkpoint.id} className="agent-card">
            <p>
              {checkpoint.path} · {checkpoint.state}
            </p>
            <small>{checkpoint.createdAt}</small>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(async (valid) => {
                  if (!id) return;
                  const value = await window.forge.getCheckpointDiff(
                    id,
                    checkpoint.id,
                  );
                  if (!valid()) return;
                  setSelected(checkpoint);
                  setDiff(value);
                  setConfirmRestore(false);
                })
              }
            >
              查看差异
            </Button>
          </article>
        ))}
        {selected && (
          <>
            <h4>{selected.path}</h4>
            <CodeBlock code={diff} language="diff" />
            <Button
              variant="danger"
              disabled={
                busy || Boolean(running) || selected.state !== "completed"
              }
              onClick={() => setConfirmRestore(true)}
            >
              恢复此文件
            </Button>
          </>
        )}
      </section>
      {confirmRestore && selected && (
        <Dialog title="确认恢复文件" onClose={() => setConfirmRestore(false)}>
          <div className="modal-content wb-stack">
            <p>
              将 {selected.path} 恢复至检查点 {selected.id}
              。若文件已被其他操作修改，主机会拒绝冲突恢复。
            </p>
            <Button
              variant="danger"
              disabled={busy || Boolean(running)}
              onClick={() =>
                void action(async (valid) => {
                  if (!id) return;
                  await window.forge.restoreCheckpoint(id, selected.id);
                  if (!valid()) return;
                  await refreshActiveSession();
                  const checkpoints = await window.forge.listCheckpoints(id);
                  if (!valid()) return;
                  setCheckpoints(checkpoints);
                  setConfirmRestore(false);
                  setSelected(null);
                })
              }
            >
              确认恢复此文件
            </Button>
            {error && <p role="alert">{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
