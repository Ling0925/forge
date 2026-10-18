import { useEffect, useState } from "react";
import type { AgentEvent } from "../../../shared/schemas";
import { sessionUsage } from "../../state/session-usage";
import type { ActiveRunState } from "../../state/workbench-reducer";

const EMPTY_EVENTS: readonly AgentEvent[] = [];

export function OutputSpeed({
  run,
  events = EMPTY_EVENTS,
}: {
  readonly run: ActiveRunState | undefined;
  readonly events?: readonly AgentEvent[];
}) {
  const { speed } = sessionUsage(events);
  const active = run?.status === "running" || run?.status === "awaiting_approval";
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active, run?.sessionId]);

  // Only matched, currently active runs contribute live time. Unmatched starts in
  // old interrupted transcripts must not count the days since the page was closed.
  const live = active && speed.runStartedAt !== undefined;
  const liveTokens = live ? speed.pendingTokens + (run?.unreportedOutputTokens ?? 0) : 0;
  const durationMs = speed.durationMs + (live ? Math.max(0, now - speed.runStartedAt!) : 0);
  const outputTokens = speed.outputTokens + liveTokens;
  const rate = durationMs > 0 ? outputTokens * 1000 / durationMs : 0;
  const estimated = speed.partial || (live && (run?.unreportedOutputTokens ?? 0) > 0);
  const value = outputTokens > 0 && Number.isFinite(rate) && rate > 0
    ? `${estimated ? "≈ " : ""}${rate < 10 ? rate.toFixed(1) : Math.round(rate)} tok/s`
    : "— tok/s";

  return (
    <span
      className="composer-output-speed"
      aria-live="off"
      title={`本会话平均输出速度：累计输出 token ÷ 各轮运行总耗时（含工具执行与等待，不含两次提问间的空闲，不含子会话）${estimated ? "；含估算或部分用量" : ""}`}
    >
      平均 {value}
    </span>
  );
}
