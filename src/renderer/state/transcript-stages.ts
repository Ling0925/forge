import { taskPlanSchema } from "../../shared/schemas";
import type { TimelineItem } from "./timeline";

export interface TranscriptStage {
  readonly id: number;
  readonly title: string | null;
}

/** Stage names come only from successful AI plan updates, never guessed prose. */
export function transcriptStages(timeline: readonly TimelineItem[]) {
  let current: TranscriptStage = { id: 0, title: null };
  let announced = false;
  const phases: number[] = [];
  const headers: (TranscriptStage | null)[] = [];
  for (const item of timeline) {
    if (item.kind === "message" && item.role === "user" && !item.origin) {
      current = { id: current.id + 1, title: null };
      announced = false;
    }
    phases.push(current.id);
    const assistant =
      item.kind === "tool" ||
      (item.kind === "message" && item.role === "assistant");
    headers.push(assistant && !announced ? current : null);
    if (assistant) announced = true;

    if (
      item.kind !== "tool" ||
      item.call.function.name !== "update_plan" ||
      item.status !== "completed"
    )
      continue;
    try {
      const result = taskPlanSchema.safeParse(JSON.parse(item.output));
      if (!result.success) continue;
      const step = result.data.steps.find((step) => step.status === "in_progress");
      if (step && step.step !== current.title) {
        current = { id: current.id + 1, title: step.step };
        announced = false;
      }
    } catch {
      // Invalid, truncated or external output cannot create a named stage.
    }
  }
  return { phases, headers, current, announced };
}

export function phaseMarkers(timeline: readonly TimelineItem[]): readonly number[] {
  return transcriptStages(timeline).phases;
}

export function foldedTool(index: number, phases: readonly number[]): boolean {
  return (phases[index] ?? 0) < (phases.at(-1) ?? 0);
}
