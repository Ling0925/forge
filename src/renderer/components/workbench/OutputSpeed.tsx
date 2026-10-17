import { useEffect, useRef, useState } from "react";
import type { ActiveRunState } from "../../state/workbench-reducer";
import { estimateTokens } from "../../../shared/context-usage";

interface SpeedSample {
  readonly time: number;
  readonly totalTokens: number;
}

interface SpeedTracker {
  key: string;
  prevTextLen: number;
  prevReasoningLen: number;
  cumulativeTokens: number;
  samples: readonly SpeedSample[];
}

const WINDOW_MS = 3000;
const MIN_INTERVAL_MS = 250;
const MAX_SAMPLES = 64;
const PLACEHOLDER_SPEED = "— tok/s";
const SPEED_TITLE = "流式文字与思考的估算输出速度";

function pruneSamples(
  samples: readonly SpeedSample[],
  now: number,
): SpeedSample[] {
  const cutoff = now - WINDOW_MS;
  return samples.filter((sample) => sample.time >= cutoff);
}

function formatSpeed(samples: readonly SpeedSample[], now: number): string {
  const windowed = pruneSamples(samples, now);
  const first = windowed[0];
  const last = windowed[windowed.length - 1];
  if (!first || !last) {
    return PLACEHOLDER_SPEED;
  }

  const elapsedSeconds = (last.time - first.time) / 1000;
  if (elapsedSeconds < MIN_INTERVAL_MS / 1000) {
    return PLACEHOLDER_SPEED;
  }

  const deltaTokens = last.totalTokens - first.totalTokens;
  const speed = deltaTokens / elapsedSeconds;
  if (!Number.isFinite(speed) || speed <= 0) {
    return PLACEHOLDER_SPEED;
  }

  return `≈ ${Math.round(speed)} tok/s`;
}

export function OutputSpeed({
  run,
}: { readonly run: ActiveRunState | undefined }) {
  const active =
    run !== undefined &&
    run.status === "running" &&
    !run.providerRetry &&
    !run.isCancelling;

  const identityKey = run
    ? `${run.runId ?? run.sessionId}:${run.streamingTurn ?? 0}:${run.providerRetry ? "retry" : "ok"}`
    : "";

  const text = run?.streamingText ?? "";
  const reasoning = run?.streamingReasoning ?? "";

  const [displaySpeed, setDisplaySpeed] = useState<string>(PLACEHOLDER_SPEED);

  const trackerRef = useRef<SpeedTracker>({
    key: "",
    prevTextLen: 0,
    prevReasoningLen: 0,
    cumulativeTokens: 0,
    samples: [],
  });

  useEffect(() => {
    const tracker = trackerRef.current;
    const now = Date.now();

    if (!active) {
      tracker.key = "";
      tracker.prevTextLen = 0;
      tracker.prevReasoningLen = 0;
      tracker.cumulativeTokens = 0;
      tracker.samples = [];
      setDisplaySpeed(PLACEHOLDER_SPEED);
      return;
    }

    const isNewKey = tracker.key !== identityKey;
    const isLengthRegression =
      text.length < tracker.prevTextLen ||
      reasoning.length < tracker.prevReasoningLen;

    if (isNewKey || isLengthRegression) {
      tracker.key = identityKey;
      tracker.prevTextLen = text.length;
      tracker.prevReasoningLen = reasoning.length;
      tracker.cumulativeTokens = 0;
      const hasContent = text.length > 0 || reasoning.length > 0;
      tracker.samples = hasContent ? [{ time: now, totalTokens: 0 }] : [];
      setDisplaySpeed(formatSpeed(tracker.samples, now));
      return;
    }

    const hasBaseline = tracker.samples.length > 0;
    if (!hasBaseline) {
      if (text.length > 0 || reasoning.length > 0) {
        tracker.prevTextLen = text.length;
        tracker.prevReasoningLen = reasoning.length;
        tracker.samples = [{ time: now, totalTokens: 0 }];
      }
      setDisplaySpeed(formatSpeed(tracker.samples, now));
      return;
    }

    const newText = text.slice(tracker.prevTextLen);
    const newReasoning = reasoning.slice(tracker.prevReasoningLen);

    if (newText.length === 0 && newReasoning.length === 0) {
      setDisplaySpeed(formatSpeed(tracker.samples, now));
      return;
    }

    const delta = estimateTokens(newText) + estimateTokens(newReasoning);
    tracker.prevTextLen = text.length;
    tracker.prevReasoningLen = reasoning.length;
    tracker.cumulativeTokens += delta;

    const nextSamples = [
      ...pruneSamples(tracker.samples, now),
      { time: now, totalTokens: tracker.cumulativeTokens },
    ];
    if (nextSamples.length > MAX_SAMPLES) {
      nextSamples.splice(0, nextSamples.length - MAX_SAMPLES);
    }
    tracker.samples = nextSamples;

    setDisplaySpeed(formatSpeed(tracker.samples, now));
  }, [active, identityKey, text, reasoning]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const timer = setInterval(() => {
      setDisplaySpeed(formatSpeed(trackerRef.current.samples, Date.now()));
    }, 500);

    return () => {
      clearInterval(timer);
    };
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <span className="composer-output-speed" aria-live="off" title={SPEED_TITLE}>
      {displaySpeed}
    </span>
  );
}
