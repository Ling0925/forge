import { expect, it } from "vitest";
import { parseSessionId } from "../../src/shared/schemas";
import { RunInputQueue } from "../../src/renderer/state/run-input-queue";

const a = parseSessionId("11111111-1111-4111-8111-111111111111");
const b = parseSessionId("22222222-2222-4222-8222-222222222222");
it("isolates sessions, retains captured run choices and pauses without dropping messages", () => {
  const queue = new RunInputQueue();
  queue.add({ sessionId: a, prompt: "first", model: "one", permission: "readonly", mode: "plan", providerSourceId: "source-a" });
  queue.add({ sessionId: a, prompt: "second", model: "two" });
  queue.add({ sessionId: b, prompt: "other session" });
  const first = queue.peek(a);
  expect(first).toMatchObject({ model: "one", mode: "plan", permission: "readonly", providerSourceId: "source-a" });
  queue.pause(a);
  expect(queue.peek(a)).toBeUndefined();
  expect(queue.items(a)).toHaveLength(2);
  expect(queue.peek(b)?.prompt).toBe("other session");
  queue.resume(a);
  if (!first) throw new Error("Missing queued input");
  queue.consume(first);
  expect(queue.peek(a)?.prompt).toBe("second");
  queue.consume(first);
  expect(queue.items(a)).toHaveLength(1);
  queue.clear(a);
  expect(queue.items(b)).toHaveLength(1);
});
it("bounds UTF-8 queue bytes while retaining earlier messages", () => {
  const queue = new RunInputQueue();
  queue.add({ sessionId: a, prompt: "先前消息" });
  expect(() => queue.add({ sessionId: a, prompt: "中".repeat(400000) })).toThrow();
  expect(queue.items(a).map(item => item.prompt)).toEqual(["先前消息"]);
});
it("restores reloads as paused input without silently executing it", () => {
  const restored = RunInputQueue.restore([{ sessionId: a, prompt: "keep me", model: "captured" }]);
  expect(restored.peek(a)).toBeUndefined();
  expect(restored.snapshot()[0]).toMatchObject({ prompt: "keep me", model: "captured" });
  restored.resume(a);
  expect(restored.peek(a)?.prompt).toBe("keep me");
});
