import { CaretDown, Cpu } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ModelCatalog } from "./ModelCatalog";

const efforts = [
  ["default", "自动"], ["none", "关闭"], ["minimal", "极低"],
  ["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "极高"],
] as const;

export function ModelPicker(props: {
  readonly value: string;
  readonly models: readonly string[];
  readonly onSelect: (model: string) => void;
  readonly onRefresh: () => void;
  readonly loading: boolean;
  readonly error: string;
  readonly reasoning?: { value: string; disabled: boolean; onChange: (value: string) => void };
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const effortIndex = efforts.findIndex(([value]) => value === props.reasoning?.value);
  const effortLabel = efforts[effortIndex]?.[1] ?? "自动";
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
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) props.onRefresh();
      }}
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
        title={`${props.value || "尚未选择模型"}${props.reasoning ? ` · 思考：${effortLabel}` : ""}`}
      >
        <Cpu size={12} aria-hidden="true" />
        <span className="composer-dropdown-label">
          {props.value.split("/").at(-1) || "选择模型"}
        </span>
        {props.reasoning && <span className="model-effort-meter" aria-label={`思考等级：${effortLabel}${effortIndex > 1 ? `，${effortIndex - 1}/5` : ""}`}>
          {[1, 2, 3, 4, 5].map(level => <span key={level} className={level <= effortIndex - 1 ? "is-filled" : ""} style={{ height: `${3 + level * 2}px` }} />)}
          {effortIndex <= 1 && <small>{effortIndex === 1 ? "关" : "自"}</small>}
        </span>}
        <CaretDown size={10} aria-hidden="true" />
      </summary>
      {open && (
        <div className="composer-model-panel">
          {props.reasoning && <fieldset className="model-effort-options" disabled={props.reasoning.disabled}>
            <legend>思考等级 <span>全局保存 · 用于后续请求</span></legend>
            <div>{efforts.map(([value, label]) => <button type="button" key={value}
              aria-pressed={props.reasoning?.value === value}
              onClick={() => props.reasoning?.onChange(value)}>{label}</button>)}</div>
          </fieldset>}
          <ModelCatalog
            {...props}
            inputId="run-model"
            onSelect={(model) => {
              props.onSelect(model);
              if (props.reasoning) return;
              close();
              ref.current?.querySelector("summary")?.focus();
            }}
          />
        </div>
      )}
    </details>
  );
}
