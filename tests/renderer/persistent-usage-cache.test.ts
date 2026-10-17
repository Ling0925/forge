import { expect, it, vi } from "vitest";
import { createPersistentUsageCache } from "../../src/renderer/state/persistent-usage-cache";
import { createSessionInfoCache } from "../../src/renderer/state/session-info-cache";
import { sessionSnapshotSchema } from "../../src/shared/schemas";

const snapshot = sessionSnapshotSchema.parse({
  version: 1,
  id: "11111111-1111-4111-8111-111111111111",
  title: "private title",
  workspace: "/private/path",
  model: "model",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:01Z",
  status: "completed",
  messages: [{ role: "user", content: "private prompt" }],
  changes: [],
  events: [
    {
      type: "run_finished",
      sessionId: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-01-01T00:00:01Z",
      status: "completed",
      turns: 1,
      toolCalls: 0,
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      usageComplete: true,
    },
  ],
});

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

it("restores completed summaries after recreation without scanning events or fetching a session", async () => {
  const disk = storage();
  const first = createPersistentUsageCache(() => disk).snapshot(snapshot);
  const reloaded = createPersistentUsageCache(() => disk);
  const events = new Proxy(snapshot.events, {
    get(target, key, receiver) {
      if (key !== "length") throw new Error("history was rescanned");
      return Reflect.get(target, key, receiver);
    },
  });
  expect(reloaded.snapshot({ ...snapshot, events })).toEqual(first);
  const stored = [...disk.values.values()].join("");
  expect(stored).not.toContain("private prompt");
  expect(stored).not.toContain("private title");
  expect(stored).not.toContain("/private/path");
  vi.stubGlobal("localStorage", disk);
  try {
    const read = vi.fn(async () => snapshot);
    expect(await createSessionInfoCache()(snapshot, read)).toMatchObject({
      tokens: "120",
    });
    expect(read).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("invalidates changed versions and event counts and never persists active sessions", () => {
  const disk = storage();
  const cache = createPersistentUsageCache(() => disk);
  cache.snapshot(snapshot);
  expect(
    cache.get({ ...snapshot, updatedAt: "2026-01-01T00:00:02Z" }),
  ).toBeUndefined();
  expect(cache.get({ ...snapshot, model: "another" })).toBeUndefined();
  const running = { ...snapshot, status: "running" as const };
  expect(cache.get(running)).toBeUndefined();
  const before = [...disk.values.values()];
  cache.snapshot(running);
  expect([...disk.values.values()]).toEqual(before);
  const changed = {
    ...snapshot,
    events: [...snapshot.events, ...snapshot.events],
  };
  expect(cache.snapshot(changed).usage.total?.totalTokens).toBe(240);
  expect(
    createPersistentUsageCache(() => disk).snapshot(changed).usage.total
      ?.totalTokens,
  ).toBe(240);
});

it("ignores pre-fix cached summaries and persists the new accounting version", () => {
  const disk = storage();
  const stale = createPersistentUsageCache(() => disk).snapshot(snapshot);
  disk.values.clear();
  disk.setItem("forge-session-usage-v1", JSON.stringify([stale]));
  const current = createPersistentUsageCache(() => disk);
  expect(current.get(snapshot)).toBeUndefined();
  expect(current.snapshot(snapshot).usage.compacted).toBe(false);
  expect(disk.getItem("forge-session-usage-v2")).not.toBeNull();
});

it("falls back on corrupt data or unavailable storage and bounds saved summaries", () => {
  const disk = storage();
  const cache = createPersistentUsageCache(() => disk);
  disk.setItem("forge-session-usage-v2", "broken json");
  expect(cache.snapshot(snapshot).usage.total?.totalTokens).toBe(120);
  const blocked = createPersistentUsageCache(() => {
    throw new Error("blocked");
  });
  expect(blocked.snapshot(snapshot).usage.total?.totalTokens).toBe(120);
  for (let index = 2; index <= 102; index++) {
    cache.snapshot(
      sessionSnapshotSchema.parse({
        ...snapshot,
        id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      }),
    );
  }
  expect(cache.get(snapshot)).toBeUndefined();
  expect(
    JSON.parse(disk.getItem("forge-session-usage-v2") ?? "[]"),
  ).toHaveLength(100);
});
