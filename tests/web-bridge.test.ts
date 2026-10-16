import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTransportBridge, requestId } from "../src/shared/bridge";
import { sessionIdSchema } from "../src/shared/schemas";

describe("shared desktop/Web bridge", () => {
  it("generates UUIDs on insecure LAN origins without randomUUID", () => {
    const id = requestId();
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(requestId()).not.toBe(id);
  });
  it("validates response correlation and never retries failed effects", async () => {
    const request = vi.fn(async () => { throw new Error("offline"); });
    const bridge = createTransportBridge({ request, onEvent: () => {} });
    await expect(bridge.listSessions()).rejects.toThrow("offline");
    expect(request).toHaveBeenCalledTimes(1);
    const wrong = createTransportBridge({ request: async () => ({ id: randomUUID(), method: "listSessions", ok: true, result: [] }), onEvent: () => {} });
    await expect(wrong.listSessions()).rejects.toThrow("Invalid host response");
  });
  it("delivers early run events only after startRun has resolved", async () => {
    const sessionId = sessionIdSchema.parse(randomUUID());
    const runId = randomUUID();
    let receive: (raw: unknown) => void = () => {};
    const bridge = createTransportBridge({
      onEvent: (listener) => { receive = listener; },
      request: async (input) => {
        receive({ runId, event: { type: "text_delta", text: "early", sessionId, timestamp: new Date().toISOString() } });
        return { id: input.id, method: input.method, ok: true, result: { sessionId, runId } };
      },
    });
    let resolved = false;
    const delivered: boolean[] = [];
    bridge.onEvent(() => delivered.push(resolved));
    await bridge.startRun({ sessionId, prompt: "test" });
    resolved = true;
    await new Promise((done) => setTimeout(done, 10));
    expect(delivered).toEqual([true]);
  });
});
