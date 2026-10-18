import { ChatText, Gear, Info, SidebarSimple } from "@phosphor-icons/react";
import { type Ref, useEffect, useState } from "react";
import { useWorkbench } from "../../state/workbench-context";
import { IconButton } from "../primitives/IconButton";
import { CommandPalette } from "./CommandPalette";
import { SessionActions } from "./SessionActions";

interface WorkbenchHeaderProps {
  readonly isNew: boolean;
  readonly pending: number;
  readonly inspector: {
    readonly collapsed: boolean;
    readonly toggleRef: Ref<HTMLButtonElement>;
    readonly reveal: () => void;
    readonly close: () => void;
  };
}

export function WorkbenchHeader({
  isNew,
  pending,
  inspector,
}: WorkbenchHeaderProps) {
  const { state, setMobileSidebar, openSettings } = useWorkbench();
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 1000px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const expanded = compact
    ? state.mobileTab === "inspector"
    : !inspector.collapsed;
  const title = isNew
    ? "新会话"
    : (state.activeSnapshot?.title ?? "Forge 工作台");
  return (
    <header className="workbench-task-header">
      <div className="wb-header-start">
        <button
          type="button"
          className="wb-icon-btn wb-drawer-toggle"
          aria-label="打开会话列表"
          aria-expanded={state.isMobileSidebarOpen}
          title="会话列表"
          onClick={() => setMobileSidebar(!state.isMobileSidebarOpen)}
        >
          <SidebarSimple size={18} />
        </button>
        <CommandPalette />
      </div>
      <div className="wb-header-title">
        <h1 title={title}>{title}</h1>
      </div>
      <div className="wb-header-end wb-header-actions">
        {pending > 0 && (
          <button
            type="button"
            className="wb-approval-pill"
            onClick={inspector.reveal}
            aria-label={`待批准 ${pending} 项，打开执行详情`}
          >
            待批准 {pending}
          </button>
        )}
        <button
          type="button"
          ref={inspector.toggleRef}
          className={`wb-icon-btn wb-details-toggle${expanded ? " is-active" : ""}`}
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起详情，返回任务" : "展开详情"}${pending > 0 ? `，待批准 ${pending} 项` : ""}`}
          title={expanded ? "返回任务" : "执行详情"}
          onClick={() => {
            setMobileSidebar(false);
            if (expanded) inspector.close();
            else inspector.reveal();
          }}
        >
          <Info size={18} className="wb-details-icon" />
          <ChatText size={18} className="wb-return-icon" />
          {pending > 0 && (
            <span
              className="wb-header-pending"
              aria-label={`待批准 ${pending} 项`}
            >
              {pending}
            </span>
          )}
        </button>
        {!isNew && <SessionActions key={state.activeSessionId ?? "none"} />}
        <IconButton
          icon={<Gear size={18} />}
          size="sm"
          label="设置"
          onClick={() => {
            setMobileSidebar(false);
            openSettings(true);
          }}
        />
      </div>
    </header>
  );
}
