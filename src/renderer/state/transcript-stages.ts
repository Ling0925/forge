import { taskPlanSchema } from "../../shared/schemas";
import type { TimelineItem } from "./timeline";

export interface TranscriptStage {
  readonly id: number;
  readonly title: string | null;
  readonly completed?: number;
  readonly total?: number;
  readonly percent?: number;
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
      !["create_plan", "update_plan"].includes(item.call.function.name) ||
      item.status !== "completed"
    )
      continue;
    try {
      const result = taskPlanSchema.safeParse(JSON.parse(item.output));
      if (!result.success) continue;
      const total = result.data.steps.length;
      const completed = result.data.steps.filter((step) => step.status === "completed").length;
      const inProgress = result.data.steps.find((step) => step.status === "in_progress");
      const title =
        inProgress?.step ??
        (completed === total ? (result.data.title || "全部步骤已完成") : (result.data.explanation || result.data.title || "计划步骤"));
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
      if (title !== current.title || completed !== current.completed) {
        current = { id: current.id + 1, title, completed, total, percent };
        // The update_plan tool itself directly renders the inline stage divider,
        // so we mark it announced immediately to avoid duplicated stage headers below it.
        announced = true;
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
