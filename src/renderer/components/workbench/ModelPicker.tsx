import { CaretDown, CaretLeft, CaretRight, Cpu } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { ModelCatalog, type ModelCatalogGroup } from "./ModelCatalog";

const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
const formatEffort = (value: string | undefined) => value === "max" ? "MAX" : value;

export function ModelPicker(props: {
  readonly value: string;
  readonly models: readonly string[];
  readonly onSelect: (model: string, sourceId?: string) => void;
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
  readonly groups?: readonly ModelCatalogGroup[] | undefined;
  readonly sourceId?: string | undefined;
  /** Human-readable label of the source the value belongs to. */
  readonly sourceLabel?: string | undefined;
  readonly disabled?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const catalogId = useId();
  const initialized = useRef(false);
  const effortIndex = efforts.findIndex(
    (value) => value === props.reasoning?.value,
  );
  const effortLabel = formatEffort(efforts[effortIndex]);
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
    props.reasoning.onChange(choice);
  };
  const close = () => {
    if (ref.current) ref.current.open = false;
    setOpen(false);
    setModelsOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    if (modelsOpen) {
      const search =
        !props.hideSearch &&
        window.matchMedia("(pointer: fine) and (min-width: 769px)").matches
          ? ref.current?.querySelector<HTMLInputElement>("input:not([type=range])")
          : null;
      const option =
        ref.current?.querySelector<HTMLButtonElement>(
          '.model-catalog-option[aria-pressed="true"]:not(:disabled)',
        ) ?? ref.current?.querySelector<HTMLButtonElement>(
          ".model-catalog-option:not(:disabled)",
        );
      const back = ref.current?.querySelector<HTMLButtonElement>(".model-picker-back");
      (search ?? option ?? back)?.focus();
    } else {
      ref.current?.querySelector<HTMLButtonElement>(".model-picker-current")?.focus();
    }
  }, [open, modelsOpen, props.hideSearch]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        ref.current &&
        !ref.current.contains(event.target)
      )
        close();
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
        if (event.currentTarget.open) {
          if (props.onOpen) props.onOpen();
          else if (!initialized.current) props.onRefresh();
          initialized.current = true;
        } else {
          setModelsOpen(false);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        if (modelsOpen) {
          setModelsOpen(false);
        } else {
          close();
          ref.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        className="composer-dropdown-trigger composer-model-summary"
        title={`${props.value || "尚未选择模型"}${props.sourceLabel ? ` · ${props.sourceLabel}` : ""}${effortLabel ? ` · 思考：${effortLabel}` : ""}`}
      >
        <Cpu size={16} aria-hidden="true" />
        <span className="composer-dropdown-label">
          {props.value.split("/").at(-1) || "选择模型"}
        </span>
        {props.sourceLabel && (
          // The source is not a separate choice: it always travels with the
          // model, so it is shown as belonging to the model rather than as a
          // control of its own.
          <span
            className="composer-model-source"
            title={`来源：${props.sourceLabel}`}
          >
            {props.sourceLabel}
          </span>
        )}
        {effortLabel && (
          <span
            className="model-effort-meter"
            aria-label={`思考等级：${effortLabel}，${effortIndex + 1}/${efforts.length}`}
          >
            {efforts.map((value, index) => (
              <span
                key={value}
                className={index <= effortIndex ? "is-filled" : ""}
              />
            ))}
          </span>
        )}
        <CaretDown size={16} aria-hidden="true" />
      </summary>
      {open && (
        <div className="composer-model-panel">
          {!modelsOpen && (
            <div className="model-picker-heading">
              <span>{props.reasoning ? "思考等级" : "模型"}</span>
              <button
                type="button"
                className="model-picker-current"
                title={`${props.value || "尚未选择模型"}${props.sourceLabel ? ` · ${props.sourceLabel}` : ""}`}
                aria-label={`选择模型：${props.value || "尚未选择"}${props.sourceLabel ? ` · ${props.sourceLabel}` : ""}`}
                onClick={() => setModelsOpen(true)}
              >
                <span>{props.value.split("/").at(-1) || "选择模型"}</span>
                {props.sourceLabel && <small>{props.sourceLabel}</small>}
                <CaretRight size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          {!modelsOpen && props.reasoning && (
            <fieldset
              className="model-effort-options"
              disabled={props.reasoning.disabled}
            >
              <legend className="visually-hidden">思考等级</legend>
              <div className="effort-slider-heading">
                <output>{formatEffort(efforts[draftEffort])}</output>
              </div>
              <div className="effort-slider" data-max={draftEffort === efforts.length - 1}>
                <div className="effort-slider-track" aria-hidden="true">
                  <span
                    className="effort-slider-fill"
                    style={{ width: `${(draftEffort / (efforts.length - 1)) * 100}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={efforts.length - 1}
                  step={1}
                  value={draftEffort}
                  aria-label="思考等级"
                  aria-valuetext={formatEffort(efforts[draftEffort])}
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
                {efforts.map((value, index) => (
                  <span key={value} data-active={draftEffort === index}>
                    {formatEffort(value)}
                  </span>
                ))}
              </div>
            </fieldset>
          )}
          {modelsOpen && (
            <div
              id={catalogId}
              className="model-picker-subpanel"
              role="region"
              aria-label="选择模型"
            >
              <div className="model-picker-subheading">
                <button
                  type="button"
                  className="model-picker-back"
                  aria-label="返回模型设置"
                  onClick={() => setModelsOpen(false)}
                >
                  <CaretLeft size={16} aria-hidden="true" />
                </button>
                <span>选择模型</span>
              </div>
              <ModelCatalog
                value={props.value}
                models={props.models}
                onRefresh={props.onRefresh}
                loading={props.loading}
                error={props.error}
                inputId={catalogId + "-search"}
                {...(props.hideSearch !== undefined ? { hideSearch: props.hideSearch } : {})}
                groups={props.groups}
                sourceId={props.sourceId}
                disabled={props.disabled}
                onSelect={(model, sourceId) => {
                  props.onSelect(model, sourceId);
                  if (props.reasoning) {
                    setModelsOpen(false);
                  } else {
                    close();
                    ref.current?.querySelector("summary")?.focus();
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
    </details>
  );
}
