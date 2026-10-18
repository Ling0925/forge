import { describe, expect, it, vi } from "vitest";
import {
  createForgeLanBridge,
  LAN_CHANNEL,
  lanRequestSchema,
  lanStatusSchema,
} from "../src/shared/lan";

const startInput = {
  action: "start" as const,
  host: "192.168.1.24",
  port: 41234,
  workspace: "/home/me/project",
};

describe("LAN pairing contract", () => {
  it("uses one dedicated channel name", () => {
    expect(LAN_CHANNEL).toBe("forge:lan");
  });

  it("accepts only the three bounded actions", () => {
    expect(lanRequestSchema.safeParse({ action: "status" }).success).toBe(true);
    expect(lanRequestSchema.safeParse({ action: "stop" }).success).toBe(true);
    expect(lanRequestSchema.safeParse(startInput).success).toBe(true);
    expect(lanRequestSchema.safeParse({ action: "restart" }).success).toBe(false);
    // No implicit side effect may ride along with status/stop.
    expect(
      lanRequestSchema.safeParse({ action: "status", host: "192.168.1.24" })
        .success,
    ).toBe(false);
    expect(lanRequestSchema.safeParse({ action: "stop", port: 41234 }).success).toBe(
      false,
    );
    expect(lanRequestSchema.safeParse({ ...startInput, extra: 1 }).success).toBe(
      false,
    );
  });

  it("requires a concrete IPv4 host, never a hostname, wildcard or public name", () => {
    for (const host of [
      "localhost",
      "0.0.0.0",
      "255.255.255.256",
      "192.168.1",
      "::1",
      "",
      "192.168.1.24/24",
      "http://192.168.1.24",
    ]) {
      expect(lanRequestSchema.safeParse({ ...startInput, host }).success).toBe(
        false,
      );
    }
    for (const host of ["10.0.0.7", "172.16.4.9", "192.168.1.24"]) {
      expect(lanRequestSchema.safeParse({ ...startInput, host }).success).toBe(
        true,
      );
    }
  });

  it("bounds the port to 1024–65535 integers and the workspace to 1–4096 chars", () => {
    for (const port of [80, 1023, 65536, 41234.5, Number.NaN, "41234"]) {
      expect(lanRequestSchema.safeParse({ ...startInput, port }).success).toBe(
        false,
      );
    }
    for (const port of [1024, 41234, 65535]) {
      expect(lanRequestSchema.safeParse({ ...startInput, port }).success).toBe(
        true,
      );
    }
    expect(
      lanRequestSchema.safeParse({ ...startInput, workspace: "" }).success,
    ).toBe(false);
    expect(
      lanRequestSchema.safeParse({ ...startInput, workspace: "x".repeat(4097) })
        .success,
    ).toBe(false);
    expect(
      lanRequestSchema.safeParse({ ...startInput, workspace: "x".repeat(4096) })
        .success,
    ).toBe(true);
  });

  it("describes status with a nullable URL and concrete IPv4 addresses only", () => {
    expect(lanStatusSchema.safeParse({ url: null, addresses: [] }).success).toBe(
      true,
    );
    expect(
      lanStatusSchema.safeParse({
        url: "http://192.168.1.24:41234/",
        addresses: ["192.168.1.24", "10.0.0.7"],
      }).success,
    ).toBe(true);
    // A hostname or a non-address string must never reach the UI as an address.
    for (const addresses of [["forge.local"], ["0.0.0.0"], ["::1"]]) {
      expect(lanStatusSchema.safeParse({ url: null, addresses }).success).toBe(
        false,
      );
    }
    // No hidden credential/token fields are part of the public DTO.
    expect(
      lanStatusSchema.safeParse({
        url: "http://192.168.1.24:41234/",
        addresses: ["192.168.1.24"],
        token: "secret",
      }).success,
    ).toBe(false);
    expect(lanStatusSchema.safeParse({ addresses: [] }).success).toBe(false);
  });
});

describe("ForgeLanBridge validation", () => {
  const status = { url: "http://192.168.1.24:41234/", addresses: ["192.168.1.24"] };

  it("validates requests before the transport and responses before the caller", async () => {
    const request = vi.fn(async () => status);
    const bridge = createForgeLanBridge({ request });

    await expect(bridge.status()).resolves.toEqual(status);
    await expect(
      bridge.start({ host: "192.168.1.24", port: 41234, workspace: "/tmp/w" }),
    ).resolves.toEqual(status);
    await expect(bridge.stop()).resolves.toEqual(status);
    expect(request.mock.calls).toEqual([
      [{ action: "status" }],
      [{ action: "start", host: "192.168.1.24", port: 41234, workspace: "/tmp/w" }],
      [{ action: "stop" }],
    ]);

    const bad = createForgeLanBridge({
      request: vi.fn(async () => ({ url: null, addresses: ["forge.local"] })),
    });
    await expect(bad.status()).rejects.toThrow("桌面返回的局域网状态无效。");
  });

  it("reports a failed call once and never replays it", async () => {
    const request = vi.fn(async () => {
      throw new Error("端口已被占用。");
    });
    const bridge = createForgeLanBridge({ request });
    await expect(
      bridge.start({ host: "192.168.1.24", port: 41234, workspace: "/tmp/w" }),
    ).rejects.toThrow("端口已被占用。");
    expect(request).toHaveBeenCalledTimes(1);

    const silent = createForgeLanBridge({
      request: vi.fn(async () => {
        throw new Error("");
      }),
    });
    await expect(silent.status()).rejects.toThrow(
      "局域网服务不可用，请检查状态后重试。",
    );
  });

  it("exposes control capability so the web host can stay read-only", () => {
    expect(createForgeLanBridge({ request: vi.fn() }).canControl).toBe(true);
    expect(
      createForgeLanBridge({ request: vi.fn() }, { canControl: false }).canControl,
    ).toBe(false);
  });
});
