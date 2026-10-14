import type { KeyboardEvent, ReactNode } from "react";
import "./tabs.css";

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly content?: ReactNode;
}

export interface TabsProps {
  readonly tabs: readonly TabItem[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly keepMounted?: boolean;
}

export function Tabs({
  tabs,
  activeId,
  onChange,
  ariaLabel = "标签选择",
  className = "",
  keepMounted = false,
}: TabsProps) {
  const handleKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const enabledIndices = tabs
      .map((t, idx) => (!t.disabled ? idx : -1))
      .filter((idx) => idx !== -1);

    const currentPos = enabledIndices.indexOf(index);
    if (currentPos === -1) return;

    let targetIndex: number | undefined;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextPos = (currentPos + 1) % enabledIndices.length;
      targetIndex = enabledIndices[nextPos];
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevPos =
        (currentPos - 1 + enabledIndices.length) % enabledIndices.length;
      targetIndex = enabledIndices[prevPos];
    } else if (e.key === "Home") {
      e.preventDefault();
      targetIndex = enabledIndices[0];
    } else if (e.key === "End") {
      e.preventDefault();
      targetIndex = enabledIndices[enabledIndices.length - 1];
    }

    if (targetIndex !== undefined) {
      const tab = tabs[targetIndex];
      if (tab) {
        const button = document.getElementById(`tab-btn-${tab.id}`);
        button?.focus();
      }
    }
  };

  const activeTab = tabs.find((t) => t.id === activeId);

  return (
    <div className={`tabs-container ${className}`.trim()}>
      <div role="tablist" aria-label={ariaLabel} className="tablist">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              id={`tab-btn-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              disabled={tab.disabled}
              className={`tab-btn ${isActive ? "is-active" : ""}`}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {(keepMounted ? tabs : activeTab ? [activeTab] : []).map(
        (tab) =>
          tab.content && (
            <div
              key={tab.id}
              id={`tabpanel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`tab-btn-${tab.id}`}
              hidden={tab.id !== activeId}
              style={tab.id !== activeId ? { display: "none" } : undefined}
              className="tabpanel"
            >
              {tab.content}
            </div>
          ),
      )}
    </div>
  );
}
