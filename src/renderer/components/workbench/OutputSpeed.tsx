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
  // Tick only during a provider request, never while tools/approval/children run.
  // Inactive interrupted transcripts must not accumulate time since page close.
  const live = run?.status === "running" && speed.requestStartedAt !== undefined;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [live, run?.sessionId, speed.requestStartedAt]);

  const liveTokens = live ? (run?.unreportedOutputTokens ?? 0) : 0;
  const durationMs = speed.durationMs + (live ? Math.max(0, now - speed.requestStartedAt!) : 0);
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
      title={`本会话平均输出速度：累计已计时请求的输出 token ÷ 请求总耗时（从请求发出到回复结束，含首 token 等待；不含工具执行、审批、重试间隔、两次提问间的空闲及子会话）${estimated ? "；含估算或仅部分请求有计时与用量" : ""}`}
    >
      平均 {value}
    </span>
  );
}
