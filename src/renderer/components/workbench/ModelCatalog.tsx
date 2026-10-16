import { ArrowClockwise, Check } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";

export function ModelCatalog({
  value,
  models,
  onSelect,
  onRefresh,
  loading,
  error,
  inputId,
}: {
  readonly value: string;
  readonly models: readonly string[];
  readonly onSelect: (model: string) => void;
  readonly onRefresh: () => void;
  readonly loading: boolean;
  readonly error: string;
  readonly inputId?: string;
}) {
  const [query, setQuery] = useState("");
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim();
  const catalog = [...new Set([value, ...models].filter(Boolean))];
  const filtered = catalog.filter((model) =>
    model.toLowerCase().includes(needle.toLowerCase()),
  );
  const custom = needle.length > 0 && !catalog.includes(needle);
  return (
    <div
      className="model-catalog"
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        if (
          event.target instanceof HTMLInputElement &&
          ["Home", "End"].includes(event.key)
        )
          return;
        const items = Array.from(
          listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        );
        if (!items.length) return;
        event.preventDefault();
        const index = items.findIndex(
          (item) => item === document.activeElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : index < 0
                ? event.key === "ArrowUp"
                  ? items.length - 1
                  : 0
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
        items[next]?.focus();
      }}
    >
      <div className="model-catalog-search">
        <Input
          id={inputId ?? id}
          aria-label="搜索模型或输入精确 ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索模型或输入精确 ID…"
          autoComplete="off"
        />
        <Button
          size="sm"
          variant="ghost"
          loading={loading}
          onClick={onRefresh}
          aria-label="刷新模型目录"
          title="刷新模型目录"
        >
          {!loading && <ArrowClockwise size={14} aria-hidden="true" />}
        </Button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="model-catalog-list" ref={listRef} aria-label="模型目录">
        {filtered.map((model) => (
          <button
            key={model}
            type="button"
            className="model-catalog-option"
            aria-pressed={model === value}
            title={model}
            onClick={() => onSelect(model)}
          >
            <span>
              <strong>{model.split("/").at(-1)}</strong>
              <small>{model}</small>
            </span>
            {model === value && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
        {custom && (
          <button
            type="button"
            className="model-catalog-option model-catalog-custom"
            onClick={() => onSelect(needle)}
          >
            <span>
              <strong>使用此模型 ID</strong>
              <small>{needle}</small>
            </span>
          </button>
        )}
      </div>
      <output className="model-catalog-hint">
        {loading
          ? "正在读取模型目录…"
          : filtered.length
            ? `${filtered.length} 个匹配模型`
            : needle
              ? "目录中没有匹配项，可确认使用输入的精确 ID。"
              : "暂无模型目录，请刷新或输入精确 ID。"}
      </output>
    </div>
  );
}
