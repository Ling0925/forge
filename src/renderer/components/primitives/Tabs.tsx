import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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

interface IndicatorGeometry {
  readonly left: number;
  readonly width: number;
}

/**
 * Segmented tabs with a sliding selection pill. The pill is measured from the
 * selected button (not an assumed equal-width share) so a long label that
 * widens one tab keeps it aligned; measurement runs after mount, on resize and
 * when the label set changes. Selection is still expressed by
 * `aria-selected` / `tabIndex`, so keyboard and screen-reader behaviour is
 * unchanged and the pill stays decorative (`aria-hidden`).
 */
export function Tabs({
  tabs,
  activeId,
  onChange,
  ariaLabel = "标签选择",
  className = "",
  keepMounted = false,
}: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorGeometry | null>(null);
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  const measure = useCallback(() => {
    const list = listRef.current;
    const button =
      activeIndex < 0
        ? undefined
        : list?.querySelectorAll<HTMLElement>('[role="tab"]')[activeIndex];
    if (!list || !button) {
      setIndicator(null);
      return;
    }
    const listBox = list.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    setIndicator({
      // Content coordinates: the pill keeps its position when the row scrolls.
      left: buttonBox.left - listBox.left + list.scrollLeft,
      width: buttonBox.width,
    });
  }, [activeIndex]);
  useEffect(() => {
    measure();
    const list = listRef.current;
    if (!list) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    // Font loading and label changes resize the row without a window resize.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => measure());
    observer?.observe(list);
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [measure]);

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
  const classes = ["tabs-container", indicator ? "has-indicator" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className="tablist"
      >
        {indicator && (
          <span
            className="tabs-indicator"
            aria-hidden="true"
            style={{
              width: `${indicator.width}px`,
              transform: `translateX(${indicator.left}px)`,
            }}
          />
        )}
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
