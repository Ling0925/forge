import { Brain, CaretRight } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Collapsible } from "../primitives/Collapsible";
import { Markdown } from "./Markdown";

/** Live viewport shows this many trailing lines; the finished row keeps one. */
export const REASONING_LIVE_LINES = 5;
/** Bound the live DOM to a trailing window; only the last lines are ever read. */
const LIVE_TAIL_LINES = 60;

/** Trailing, non-empty thought line, flattened for a single history row. */
export function lastReasoningLine(text: string): string {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.replace(/\s+/g, " ").trim();
    if (line) return line;
  }
  return "";
}

/**
 * Reasoning is a bespoke, non-native component so it matches the workbench
 * instead of a browser disclosure. While the model is thinking it streams the
 * trailing lines through a small auto-scrolling viewport; once the thought is
 * done it collapses to the last line, keeping the transcript compact. Only
 * reasoning text actually returned by the provider is ever shown.
 */
export function Reasoning({
  text,
  live = false,
  truncated = false,
  expanded: controlledExpanded,
  onExpandedChange,
  status,
}: {
  readonly text: string;
  readonly live?: boolean;
  readonly truncated?: boolean;
  readonly expanded?: boolean | undefined;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly status?: "failed" | "cancelled" | "unconfirmed" | undefined;
}) {
  const [localExpanded, setExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const viewport = useRef<HTMLDivElement>(null);
  // Keep the newest line in view as the thought grows. Runs after every render
  // (each delta re-renders), which is exactly when the viewport must re-pin.
  useLayoutEffect(() => {
    if (live) {
      const node = viewport.current;
      if (node) node.scrollTop = node.scrollHeight;
    }
  });
  if (!text) return null;
  const last = lastReasoningLine(text);
  if (!live && !last) return null;

  const tail = live
    ? text.split("\n").slice(-LIVE_TAIL_LINES).join("\n")
    : "";

  return (
    <section
      className={`reasoning ${live ? "reasoning-live" : "reasoning-done"}`}
      data-reasoning-status={status}
      aria-label={live ? "思考中" : `思考过程：${last}`}
    >
      <button
        type="button"
        className="reasoning-head"
        disabled={live}
        onClick={live ? undefined : () => onExpandedChange ? onExpandedChange(!expanded) : setExpanded(!expanded)}
        aria-expanded={live ? undefined : expanded}
        aria-label={live ? "思考中" : `思考过程：${last}`}
      >
        <Brain
          size={14}
          weight={live ? "fill" : "regular"}
          className="reasoning-glyph"
          aria-hidden="true"
        />
        {live ? (
          <span className="reasoning-label">思考中</span>
        ) : (
          <span className="reasoning-summary" title={last}>
            {last}
          </span>
        )}
        {status && <span className="wb-muted">未保存的思考预览{status === "failed" ? " · 失败" : status === "cancelled" ? " · 已取消" : " · 未确认"}</span>}
        {!live && (
          <CaretRight
            size={12}
            weight="bold"
            className={`reasoning-caret${expanded ? " is-expanded" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>

      <Collapsible open={live}>
        <div className="reasoning-viewport" ref={viewport}>
          <span className="reasoning-text">{tail}</span>
        </div>
      </Collapsible>

      <Collapsible open={!live && expanded}>
        <div className="reasoning-full">
          {truncated && (
            <p className="wb-muted">思考预览已达显示上限，内容可能不完整。</p>
          )}
          <Markdown source={text} />
        </div>
      </Collapsible>
    </section>
  );
}
