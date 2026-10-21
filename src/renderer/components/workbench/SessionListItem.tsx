import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionSummary } from "../../shared-types";
import { readSessionInfo } from "../../state/session-info-cache";
import { seedSessionUsage } from "../../state/session-usage";
import { useWorkbench } from "../../state/workbench-context";
import { SessionActions } from "./SessionActions";

const labels: Readonly<Record<string, string>> = {
  running: "执行中",
  awaiting_approval: "待批准",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "中断",
  idle: "空闲",
};

export function SessionListItem({
  session,
}: { readonly session: SessionSummary }) {
  const { state, selectSession, setMobileSidebar } = useWorkbench();
  const run = state.activeRuns[session.id];
  const pending = Boolean(run?.pendingApproval);
  const status = pending
    ? "awaiting_approval"
    : (run?.status ?? session.status);
  const active =
    !state.isNewSessionOpen && session.id === state.activeSessionId;
  const [open, setOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [info, setInfo] = useState({ tokens: "读取中…", model: session.model });
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfo({ tokens: "读取中…", model: session.model });
    const timer = setTimeout(() => {
      void readSessionInfo(
        {
          id: session.id,
          updatedAt: session.updatedAt,
          status: session.status,
          model: session.model,
        },
        async () => {
          const bridge = window.forge;
          const getPage = bridge.getSessionPage;
          if (!getPage) return bridge.getSession(session.id);
          const { snapshot, page } = await getPage(session.id);
          // The page contract always carries its prefix summary. Never turn a
          // missing summary into a full-history fetch for a sidebar hover.
          seedSessionUsage(snapshot.events, page.usageBefore);
          return { ...snapshot, transcript: page };
        },
      )
        .then((summary) => {
          if (cancelled) return;
          setInfo(summary);
        })
        .catch(() => {
          if (!cancelled)
            setInfo({ tokens: "暂时无法读取", model: session.model });
        });
    }, 200);
    const dismiss = () => setOpen(false);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, session.id, session.model, session.updatedAt, session.status]);
  const reveal = () => {
    if (isMenuOpen) return;
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;
    const sidebar = anchor.current?.closest(".workbench-sidebar");
    const sidebarRect = sidebar?.getBoundingClientRect();
    const anchorRight = sidebarRect ? sidebarRect.right : box.right;
    const tooltipWidth = 280;
    const gap = 8;
    let left = anchorRight + gap;
    if (left + tooltipWidth > window.innerWidth - gap) {
      left = Math.max(gap, window.innerWidth - tooltipWidth - gap);
    }
    setPosition({
      left,
      top: Math.max(8, Math.min(box.top, window.innerHeight - 270)),
    });
    setOpen(true);
  };
  return (
    <div
      className={`session-item ${active ? "is-active" : ""}${isMenuOpen ? " is-menu-open" : ""}`}
      onMouseEnter={reveal}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={anchor}
        type="button"
        className="session-item-main"
        onFocus={reveal}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onClick={() => {
          setOpen(false);
          void selectSession(session.id);
          setMobileSidebar(false);
        }}
        aria-current={active ? "true" : undefined}
        aria-describedby={open ? tooltipId : undefined}
      >
        {status !== "completed" && (
          <span
            className={`wb-status-dot${pending ? " is-pending" : ""}`}
            data-status={status}
            role="img"
            aria-label={labels[status] ?? status}
          />
        )}
        <span className="session-item-title">
          {session.archived ? "归档 · " : ""}
          {session.title}
        </span>
      </button>
      <SessionActions
        session={session}
        onMouseEnter={() => setOpen(false)}
        onOpenChange={(menuActive) => {
          setIsMenuOpen(menuActive);
          if (menuActive) setOpen(false);
        }}
      />
      {open &&
        !isMenuOpen &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="session-hover-info"
            style={{
              ...position,
              maxHeight: `calc(100dvh - ${position.top + 8}px)`,
            }}
          >
            <strong>{session.title}</strong>
            <dl>
              <dt>状态</dt>
              <dd>{labels[status] ?? status}</dd>
              <dt>创建时间</dt>
              <dd>
                {new Date(session.createdAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </dd>
              <dt>更新时间</dt>
              <dd>
                {new Date(session.updatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </dd>
              <dt>累计 token</dt>
              <dd>{info.tokens}</dd>
              <dt>模型 ID</dt>
              <dd>{info.model}</dd>
              <dt>工作区</dt>
              <dd>{session.workspace}</dd>
            </dl>
            <p>本会话已结束运行的报告用量，不含子会话。</p>
          </div>,
          document.body,
        )}
    </div>
  );
}
