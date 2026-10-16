import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, SessionSnapshot } from "../../shared-types";
import { persistentUsageCache } from "../../state/persistent-usage-cache";
import { compactTokens, sessionUsage } from "../../state/session-usage";
import "./usage-popover.css";

const percent = (value: number | undefined) =>
  value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

export function UsagePopover({
  events,
  snapshot,
}: {
  readonly events: readonly AgentEvent[];
  readonly snapshot?: SessionSnapshot | undefined;
}) {
  const usage = useMemo(
    () =>
      snapshot &&
      ["completed", "failed", "cancelled", "interrupted"].includes(
        snapshot.status,
      )
        ? persistentUsageCache.snapshot(snapshot).usage
        : sessionUsage(events),
    [events, snapshot],
  );
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const context = usage.context;
  const ratio = context?.windowTokens
    ? context.usedTokens / context.windowTokens
    : undefined;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        ref.current &&
        !ref.current.contains(event.target)
      )
        ref.current.open = false;
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <details
      ref={ref}
      className="composer-usage"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && ref.current)
          ref.current.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && ref.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        className="composer-dropdown-trigger usage-trigger"
        aria-label="上下文与用量"
        title="查看上下文与会话用量"
      >
        {usage.latestCache !== undefined && (
          <span className="usage-cache-chip">
            CH {percent(usage.latestCache)}
          </span>
        )}
        <svg className="usage-ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7" className="usage-ring-track" />
          {ratio !== undefined && (
            <circle
              cx="10"
              cy="10"
              r="7"
              pathLength="100"
              className="usage-ring-value"
              strokeDasharray={`${Math.min(100, ratio * 100)} 100`}
            />
          )}
        </svg>
        <span>
          {ratio === undefined
            ? "上下文"
            : `${context?.estimated ? "≈" : ""}${percent(ratio)}`}
        </span>
      </summary>
      {open && (
        <section className="usage-panel" aria-label="用量详情" tabIndex={-1}>
          <strong>用量</strong>
          <dl>
            <dt>上下文{context?.estimated ? "（估算）" : ""}</dt>
            <dd>
              {context
                ? `${percent(ratio)} / ${compactTokens(context.usedTokens)}`
                : "尚无数据"}
            </dd>
          </dl>
          {ratio !== undefined && (
            <progress
              aria-label="上下文占用"
              max={100}
              value={Math.min(100, ratio * 100)}
            />
          )}
          <p className="usage-caption">
            {context?.windowTokens
              ? `窗口 ${compactTokens(context.windowTokens)} tokens`
              : "上下文窗口未知，暂不计算百分比"}
          </p>
          <h4>会话</h4>
          <dl>
            <dt>费用估算</dt>
            <dd>未提供价格</dd>
            <dt>平均缓存命中{usage.cachePartial ? "（已上报）" : ""}</dt>
            <dd>{percent(usage.averageCache)}</dd>
            <dt>最近缓存命中（CH）</dt>
            <dd>{percent(usage.latestCache)}</dd>
          </dl>
          <h4>Tokens{usage.partial ? " · 部分统计" : ""}</h4>
          <dl>
            <dt>输入 / 输出</dt>
            <dd>
              {usage.total
                ? `${compactTokens(usage.total.promptTokens)} / ${compactTokens(usage.total.completionTokens)}`
                : "—"}
            </dd>
            <dt>缓存读取{usage.cachePartial ? "（已上报）" : ""}</dt>
            <dd>
              {usage.cacheRead === undefined
                ? "—"
                : compactTokens(usage.cacheRead)}
            </dd>
            <dt>总计</dt>
            <dd>
              {usage.total ? compactTokens(usage.total.totalTokens) : "—"}
            </dd>
          </dl>
        </section>
      )}
    </details>
  );
}
