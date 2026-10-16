import { expect, it, vi } from "vitest";
import { createSessionInfoCache } from "../../src/renderer/state/session-info-cache";
import { sessionSnapshotSchema } from "../../src/shared/schemas";

const snapshot = sessionSnapshotSchema.parse({
  version: 1,
  id: "11111111-1111-4111-8111-111111111111",
  title: "test",
  workspace: "/tmp",
  model: "model",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  status: "completed",
  messages: [],
  events: [],
  changes: [],
});

it("deduplicates concurrent hover reads, expires and invalidates changed summaries", async () => {
  let now = 0;
  const cache = createSessionInfoCache(() => now);
  const read = vi.fn(async () => snapshot);
  const first = cache(snapshot, read);
  expect(cache(snapshot, read)).toBe(first);
  await first;
  await cache(snapshot, read);
  expect(read).toHaveBeenCalledTimes(1);
  now = 60001;
  await cache(snapshot, read);
  expect(read).toHaveBeenCalledTimes(2);
  const changed = { ...snapshot, updatedAt: "2026-01-01T00:00:01Z" };
  await cache(changed, read);
  expect(read).toHaveBeenCalledTimes(3);
  const running = { ...changed, status: "running" as const };
  await cache(running, read);
  now += 2001;
  await cache(running, read);
  expect(read).toHaveBeenCalledTimes(5);
});

it("retries failures and bounds retained summaries to 100", async () => {
  const cache = createSessionInfoCache();
  const fail = vi.fn(async () => {
    throw new Error("offline");
  });
  await expect(cache(snapshot, fail)).rejects.toThrow("offline");
  const read = vi.fn(async () => snapshot);
  await cache(snapshot, read);
  for (let index = 2; index <= 102; index++) {
    const other = sessionSnapshotSchema.parse({
      ...snapshot,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    });
    await cache(other, async () => other);
  }
  await cache(snapshot, read);
  expect(read).toHaveBeenCalledTimes(2);
});
