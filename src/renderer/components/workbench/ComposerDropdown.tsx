import { CaretDown, Check } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export function ComposerDropdown<T extends string>({
  value,
  onChange,
  options,
  icon,
  ariaLabel,
  disabled = false,
}: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    readonly sub?: string;
  }[];
  readonly icon?: ReactNode;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    if (disabled) {
      setOpen(false);
      return;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open, disabled]);

  return (
    <div
      className={`composer-dropdown ${open ? "is-open" : ""}`}
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        if (!open) {
          if (!disabled) setOpen(true);
          return;
        }
        const items = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        );
        const index = items.findIndex(
          (item) => item === document.activeElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="composer-dropdown-trigger"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
      >
        {icon && <span className="composer-dropdown-icon">{icon}</span>}
        <span className="composer-dropdown-label">{current?.label}</span>
        <CaretDown
          size={10}
          aria-hidden="true"
          className="composer-dropdown-caret"
        />
      </button>
      {open && !disabled && (
        <div
          ref={menuRef}
          id={menuId}
          className="composer-dropdown-menu"
          role="menu"
          aria-label={ariaLabel}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={-1}
              className={`composer-dropdown-item ${option.value === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span className="composer-dropdown-item-main">
                <span className="composer-dropdown-item-title">
                  {option.label}
                </span>
                {option.sub && (
                  <span className="composer-dropdown-item-sub">
                    {option.sub}
                  </span>
                )}
              </span>
              {option.value === value && (
                <Check
                  size={12}
                  weight="bold"
                  aria-hidden="true"
                  className="composer-dropdown-check"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
