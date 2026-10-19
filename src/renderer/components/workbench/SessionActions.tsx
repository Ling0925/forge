import { DotsThreeVertical } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OperationScope } from "../../state/operation-scope";
import { hostCapabilities } from "../../web-host";
import type { SessionSummary } from "../../shared-types";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";
import { Dialog } from "./Dialog";

export interface SessionActionsProps {
  readonly session?: SessionSummary;
  readonly onOpenChange?: (open: boolean) => void;
}

export function SessionActions({
  session,
  onOpenChange,
}: SessionActionsProps = {}) {
  const { state, selectSession, loadSessions, refreshActiveSession } =
    useWorkbench();
  const target = session ?? state.activeSnapshot;
  const scope = useRef(new OperationScope());
  useEffect(() => {
    scope.current = new OperationScope();
    return () => scope.current.close();
  }, []);

  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState("");

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setIsOpen(false);
    onOpenChange?.(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (
        menuRef.current &&
        !menuRef.current.contains(targetNode) &&
        triggerRef.current &&
        !triggerRef.current.contains(targetNode)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    const handleScroll = () => {
      closeMenu();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  if (!target) return null;

  const targetId = target.id;
  const targetTitle = target.title;
  const isArchived = Boolean(target.archived);

  const run = state.activeRuns[targetId];
  const locked =
    busy || run?.status === "running" || run?.status === "awaiting_approval";

  const toggleMenu = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (isOpen) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 160;
    const menuHeight = 170;
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight && rect.top > menuHeight) {
      top = rect.top - menuHeight - 4;
    }
    let left = rect.right - menuWidth;
    if (left < 8) left = 8;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    setMenuPosition({ top, left });
    setIsOpen(true);
    onOpenChange?.(true);
  };

  const action = async (operation: (valid: () => boolean) => Promise<void>) => {
    const valid = scope.current.begin();
    setBusy(true);
    setError("");
    try {
      await operation(valid);
      if (!valid()) return;
      await loadSessions();
      if (targetId === state.activeSessionId) {
        await refreshActiveSession();
      }
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
      const saved = await window.forge.exportSession(targetId);
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

  return (
    <div
      className="session-actions wb-session-actions"
      aria-label="会话操作"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`wb-icon-btn session-action-btn${isOpen ? " is-active" : ""}`}
        aria-label="会话操作"
        aria-expanded={isOpen}
        title={locked ? "会话操作（运行中暂不可用）" : "会话操作"}
        onClick={toggleMenu}
      >
        <DotsThreeVertical size={15} weight="bold" />
        {renaming && <span className="wb-dirty-dot" aria-hidden="true" />}
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="session-actions-menu-dropdown wb-stack"
            style={{
              position: "fixed",
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              zIndex: 1000,
            }}
            role="menu"
            aria-label="会话操作菜单"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              className="wb-menu-item"
              disabled={locked}
              onClick={() => {
                closeMenu();
                setTitle(targetTitle);
                setRenaming(true);
              }}
            >
              重命名
            </Button>
            <Button
              size="sm"
              className={`wb-menu-item${isArchived ? "" : " is-danger"}`}
              disabled={locked}
              onClick={() => {
                closeMenu();
                void action(async () => {
                  await window.forge.archiveSession(targetId, !isArchived);
                });
              }}
            >
              {isArchived ? "取消归档" : "归档"}
            </Button>
            <Button
              size="sm"
              className="wb-menu-item"
              disabled={locked}
              onClick={() => {
                closeMenu();
                void action(async (valid) => {
                  const fork = await window.forge.forkSession(targetId);
                  if (valid()) await selectSession(fork.id);
                });
              }}
            >
              分叉会话
            </Button>
            <Button
              size="sm"
              className="wb-menu-item"
              disabled={busy || !hostCapabilities.exportSession}
              title={
                hostCapabilities.exportSession
                  ? "导出 JSON"
                  : "Web 开发版暂不支持桌面文件导出"
              }
              onClick={() => void exportSession()}
            >
              {hostCapabilities.exportSession
                ? "导出 JSON"
                : "导出 JSON（仅桌面端）"}
            </Button>
            {exportState && (
              <output className="wb-inline-note">{exportState}</output>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}

      {renaming && (
        <Dialog title="重命名会话" onClose={() => setRenaming(false)}>
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async (valid) => {
                await window.forge.renameSession(targetId, title.trim());
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
    </div>
  );
}
