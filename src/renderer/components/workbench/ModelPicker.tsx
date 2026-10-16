import { CaretDown, Cpu } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ModelCatalog } from "./ModelCatalog";

export function ModelPicker(props: {
  readonly value: string;
  readonly models: readonly string[];
  readonly onSelect: (model: string) => void;
  readonly onRefresh: () => void;
  readonly loading: boolean;
  readonly error: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        ref.current &&
        !ref.current.contains(event.target)
      )
        ref.current.open = false;
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);
  return (
    <details
      ref={ref}
      className="composer-model composer-model-picker"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        ref.current?.querySelector("summary")?.focus();
      }}
    >
      <summary
        className="composer-dropdown-trigger composer-model-summary"
        title={props.value || "尚未选择模型"}
      >
        <Cpu size={12} aria-hidden="true" />
        <span className="composer-dropdown-label">
          {props.value.split("/").at(-1) || "选择模型"}
        </span>
        <CaretDown size={10} aria-hidden="true" />
      </summary>
      {open && (
        <div className="composer-model-panel">
          <ModelCatalog
            {...props}
            inputId="run-model"
            onSelect={(model) => {
              props.onSelect(model);
              close();
              ref.current?.querySelector("summary")?.focus();
            }}
          />
        </div>
      )}
    </details>
  );
}
