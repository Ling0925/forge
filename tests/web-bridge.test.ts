import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTransportBridge, requestId } from "../src/shared/bridge";
import { sessionIdSchema } from "../src/shared/schemas";
import { ForgeError } from "../src/shared/errors";
import type { RpcRequest } from "../src/shared/ipc";

describe("shared desktop/Web bridge", () => {
  it("retains recovery events until the UI subscribes", async () => {
    let receive: (raw: unknown) => void = () => {};
    const bridge = createTransportBridge({ request: async () => null, onEvent: (listener) => { receive = listener; } });
    const event = { runId: randomUUID(), event: { type: "text_delta", text: "restored", sessionId: randomUUID(), timestamp: new Date().toISOString() } };
    receive(event);
    await new Promise((done) => setTimeout(done, 10));
    const listener = vi.fn();
    bridge.onEvent(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(event));
    expect(listener).toHaveBeenCalledTimes(1);
  });
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
  it.each([true, false])("preserves structured storage errors (retryable=%s) without replaying RPCs", async (retryable) => {
    const error = { code: "storage", message: "Safe storage failure", retryable };
    const request = vi.fn(async (input: RpcRequest) => ({ id: input.id, method: input.method, ok: false, error }));
    const bridge = createTransportBridge({ request, onEvent: () => {} });
    const result = bridge.getSession(sessionIdSchema.parse(randomUUID()));
    await expect(result).rejects.toBeInstanceOf(ForgeError);
    await expect(result).rejects.toMatchObject(error);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("never retries effectful calls even when the host marks its error retryable", async () => {
    const request = vi.fn(async (input: RpcRequest) => ({ id: input.id, method: input.method, ok: false,
      error: { code: "storage", message: "Safe storage failure", retryable: true } }));
    const bridge = createTransportBridge({ request, onEvent: () => {} });
    const sessionId = sessionIdSchema.parse(randomUUID());
    await expect(bridge.startRun({ sessionId, prompt: "execute once" })).rejects.toMatchObject({ retryable: true });
    await expect(bridge.renameSession(sessionId, "changed")).rejects.toMatchObject({ retryable: true });
    expect(request.mock.calls.map(([input]) => input.method)).toEqual(["startRun", "renameSession"]);
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
