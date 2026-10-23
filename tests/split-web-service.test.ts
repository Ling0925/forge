import { expect, it, vi } from "vitest";
import { waitForIdle } from "../scripts/switch-split-web.mjs";

const idle = { hostId: "old-core", runs: [] };
const busy = { ...idle, runs: [{ status: "running" }] };
function clock() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => { now += ms; }, log: vi.fn(), intervalMs: 10, quietMs: 20, timeoutMs: 100 };
}
it("refuses to stop a busy all-in-one server without waiting", async () => {
  await expect(waitForIdle(async () => busy, clock())).rejects.toThrow("Active conversations remain");
});
it("requires a fresh quiet window after any new run", async () => {
  const options = clock();
  const samples = [busy, idle, busy, idle, idle, idle];
  const read = vi.fn(async () => samples.shift() ?? busy);
  await expect(waitForIdle(read, { ...options, wait: true })).resolves.toEqual(idle);
  expect(read).toHaveBeenCalledTimes(6);
  expect(options.now()).toBe(50);
});
it("fails closed on host replacement or unreadable state", async () => {
  const samples = [idle, { ...idle, hostId: "replacement" }];
  await expect(waitForIdle(async () => samples.shift(), clock())).rejects.toThrow("identity changed");
  const failure = new Error("disconnected");
  await expect(waitForIdle(async () => { throw failure; }, clock())).rejects.toBe(failure);
});
it("times out without issuing any cancellation or stop operation", async () => {
  const options = clock();
  await expect(waitForIdle(async () => busy, { ...options, wait: true })).rejects.toThrow("old service was not stopped");
  expect(options.now()).toBe(100);
});
