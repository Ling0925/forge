import { CaretDown, Cpu } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ModelCatalog } from "./ModelCatalog";

const efforts = [
  ["default", "自动"],
  ["none", "关闭"],
  ["minimal", "极低"],
  ["low", "低"],
  ["medium", "中"],
  ["high", "高"],
  ["xhigh", "极高"],
] as const;

export function ModelPicker(props: {
  readonly value: string;
  readonly models: readonly string[];
  readonly onSelect: (model: string) => void;
  readonly onRefresh: () => void;
  readonly onOpen?: () => void;
  readonly loading: boolean;
  readonly error: string;
  readonly reasoning?: {
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
  };
  readonly hideSearch?: boolean;
  readonly sourceControl?: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const initialized = useRef(false);
  const effortIndex = efforts.findIndex(
    ([value]) => value === props.reasoning?.value,
  );
  const effortLabel = efforts[effortIndex]?.[1] ?? "自动";
  const [draftEffort, setDraftEffort] = useState(Math.max(0, effortIndex));
  const submittedEffort = useRef<number | null>(null);
  useEffect(() => {
    if (props.reasoning?.disabled) return;
    setDraftEffort(Math.max(0, effortIndex));
    submittedEffort.current = null;
  }, [effortIndex, props.reasoning?.disabled]);
  const commitEffort = (index: number) => {
    const choice = efforts[index];
    if (
      !choice ||
      !props.reasoning ||
      props.reasoning.disabled ||
      index === effortIndex ||
      submittedEffort.current === index
    )
      return;
    submittedEffort.current = index;
    props.reasoning.onChange(choice[0]);
  };
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  useEffect(() => {
    if (!open) return;
    if (
      !props.hideSearch &&
      window.matchMedia("(pointer: fine) and (min-width: 769px)").matches
    )
      ref.current
        ?.querySelector<HTMLInputElement>("input:not([type=range])")
        ?.focus();
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
  }, [open, props.hideSearch]);
  return (
    <details
      ref={ref}
      className="composer-model composer-model-picker"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          if (props.onOpen) props.onOpen();
          else if (!initialized.current) props.onRefresh();
          initialized.current = true;
        }
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
        <Cpu size={16} aria-hidden="true" />
        <span className="composer-dropdown-label">
          {props.value.split("/").at(-1) || "选择模型"}
        </span>
        {props.reasoning && (
          <span
            className="model-effort-meter"
            aria-label={`思考等级：${effortLabel}${effortIndex > 1 ? `，${effortIndex - 1}/5` : ""}`}
          >
            {[1, 2, 3, 4, 5].map((level) => (
              <span
                key={level}
                className={level <= effortIndex - 1 ? "is-filled" : ""}
              />
            ))}
            {effortIndex <= 1 && (
              <small>{effortIndex === 1 ? "关" : "自"}</small>
            )}
          </span>
        )}
        <CaretDown size={16} aria-hidden="true" />
      </summary>
      {open && (
        <div className="composer-model-panel">
          {props.reasoning && (
            <fieldset
              className="model-effort-options"
              disabled={props.reasoning.disabled}
            >
              <legend>
                思考等级 <span>全局保存 · 用于后续请求</span>
              </legend>
              <div className="effort-slider-heading">
                <span>
                  {props.reasoning.disabled ? "暂不可调整" : "拖动选择等级"}
                </span>
                <output>{efforts[draftEffort]?.[1]}</output>
              </div>
              <div className="effort-slider" data-max={draftEffort === 6}>
                <div className="effort-slider-track" aria-hidden="true">
                  <span
                    className="effort-slider-fill"
                    style={{ width: `${(draftEffort / 6) * 100}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={1}
                  value={draftEffort}
                  aria-label="思考等级"
                  aria-valuetext={efforts[draftEffort]?.[1]}
                  onChange={(event) =>
                    setDraftEffort(Number(event.currentTarget.value))
                  }
                  onPointerUp={(event) =>
                    commitEffort(Number(event.currentTarget.value))
                  }
                  onPointerCancel={() =>
                    setDraftEffort(Math.max(0, effortIndex))
                  }
                  onKeyUp={(event) => {
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                        "Home",
                        "End",
                        "PageUp",
                        "PageDown",
                      ].includes(event.key)
                    )
                      commitEffort(Number(event.currentTarget.value));
                  }}
                  onBlur={(event) =>
                    commitEffort(Number(event.currentTarget.value))
                  }
                />
              </div>
              <div className="effort-slider-labels" aria-hidden="true">
                {efforts.map(([value, label], index) => (
                  <span key={value} data-active={draftEffort === index}>
                    {label}
                  </span>
                ))}
              </div>
            </fieldset>
          )}
          {props.sourceControl && (
            <div className="composer-model-source-area">
              <div className="composer-model-source-label">模型来源</div>
              <div className="composer-model-source-control">
                {props.sourceControl}
              </div>
            </div>
          )}
          <ModelCatalog
            value={props.value}
            models={props.models}
            onRefresh={props.onRefresh}
            loading={props.loading}
            error={props.error}
            inputId="run-model"
            {...(props.hideSearch !== undefined ? { hideSearch: props.hideSearch } : {})}
            onSelect={(model) => {
              props.onSelect(model);
              if (props.reasoning && !props.hideSearch) return;
              close();
              ref.current?.querySelector("summary")?.focus();
            }}
          />
        </div>
      )}
    </details>
  );
}
