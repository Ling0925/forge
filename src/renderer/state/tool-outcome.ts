import { toolResultSchema } from "../../shared/schemas";
import type { SessionSnapshot, ToolResult } from "../shared-types";

function decodeStoredResult(content: string): ToolResult | undefined {
  try {
    const parsed = toolResultSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Protocol-settlement messages are results, not proof that a tool executed. */
export function toolOutcome(
  snapshot: SessionSnapshot,
  callId: string,
): {
  readonly status: "running" | "completed" | "failed";
  readonly output: string;
} {
  const event = snapshot.events.findLast(
    (entry) => entry.type === "tool_finished" && entry.toolCallId === callId,
  );
  const stored = snapshot.messages.findLast(
    (message) => message.role === "tool" && message.tool_call_id === callId,
  );
  const result =
    event?.type === "tool_finished"
      ? event.result
      : stored?.content
        ? decodeStoredResult(stored.content)
        : undefined;
  if (result) {
    return {
      status: result.isError ? "failed" : "completed",
      output: result.content,
    };
  }
  // Malformed/legacy content must not be silently promoted to successful execution.
  if (stored)
    return { status: "failed", output: stored.content ?? "工具结果无法验证" };
  const terminal = !["running", "awaiting_approval"].includes(snapshot.status);
  return {
    status: terminal ? "failed" : "running",
    output: terminal ? "没有已确认的工具执行结果；运行已结束。" : "",
  };
}
