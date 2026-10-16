import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, SessionSnapshot } from "../../shared-types";
import { persistentUsageCache } from "../../state/persistent-usage-cache";
import { compactTokens, sessionUsage } from "../../state/session-usage";
import "./usage-popover.css";

const percent = (value: number | undefined) =>
  value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
const categories = [
  ["instructions", "指令"], ["memory", "记忆"],
  ["conversation", "对话"], ["tools", "工具"],
] as const;

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
  const partsTotal = context ? categories.reduce((sum, [key]) => sum + context.parts[key], 0) : 0;
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
        className="usage-trigger"
        aria-label="上下文与用量"
        title="查看上下文与会话用量"
      >
        <span className="usage-track" aria-hidden="true">
          {context && ratio !== undefined && categories.map(([key, label]) => (
            <span key={key} className={`usage-segment usage-${key}`}
              title={`${label}：≈${compactTokens(context.parts[key])} tokens`}
              style={{ width: `${partsTotal ? context.parts[key] / partsTotal * Math.min(1, ratio) * 100 : 0}%` }} />
          ))}
        </span>
        <span className="usage-footer-stats">
          <span className="usage-cache-chip" title="最近请求缓存命中率">CH {percent(usage.latestCache)}</span>
          <span className="usage-footer-total">
            {context ? `${context.estimated ? "≈" : ""}${compactTokens(context.usedTokens)}${context.windowTokens ? ` / ${compactTokens(context.windowTokens)}` : " tokens"}` : "上下文 —"}
          </span>
        </span>
      </summary>
      {open && (
        <section className="usage-panel" aria-label="用量详情" tabIndex={-1}>
          <strong>用量</strong>
          <dl>
            <dt>上下文{context?.estimated ? "（估算）" : ""}</dt>
            <dd>
              {context
                ? ratio === undefined
                  ? `${compactTokens(context.usedTokens)} tokens 已用`
                  : `${percent(ratio)} / ${compactTokens(context.usedTokens)}`
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
          {context && <dl className="usage-legend">
            {categories.map(([key, label]) => (
              <div key={key}>
                <dt><span className={`usage-legend-dot usage-${key}`} />{label}</dt>
                <dd>≈{compactTokens(context.parts[key])}</dd>
              </div>
            ))}
          </dl>}
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
