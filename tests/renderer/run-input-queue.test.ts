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
it("supports removing, editing in place, and reordering queued items while preserving keys", () => {
  const queue = new RunInputQueue();
  const first = queue.add({ sessionId: a, prompt: "one", model: "m1", mode: "plan", permission: "readonly" });
  const second = queue.add({ sessionId: a, prompt: "two", model: "m2" });
  const third = queue.add({ sessionId: a, prompt: "three", model: "m3" });
  const firstKey = queue.keyOf(first);
  const secondKey = queue.keyOf(second);
  const thirdKey = queue.keyOf(third);

  const updated = queue.updateAt(a, 0, "one updated");
  expect(updated).toMatchObject({ prompt: "one updated", model: "m1", mode: "plan", permission: "readonly" });
  if (!updated) throw new Error("Expected updated item");
  expect(queue.keyOf(updated)).toBe(firstKey);

  expect(queue.reorder(a, 2, 0)).toBe(true);
  expect(queue.items(a).map(item => item.prompt)).toEqual(["three", "one updated", "two"]);
  expect(queue.items(a).map(item => queue.keyOf(item))).toEqual([thirdKey, firstKey, secondKey]);

  const removed = queue.removeAt(a, 1);
  expect(removed?.prompt).toBe("one updated");
  expect(queue.items(a).map(item => item.prompt)).toEqual(["three", "two"]);
});
