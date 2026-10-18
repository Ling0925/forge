import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { z } from "zod";
import { createHarness } from "../src/core/harness";
import { createRuntimeHub } from "../src/desktop/runtime";
import { type RunEvent, runEventSchema } from "../src/shared/ipc";
import {
  createLanHostController,
  shutdownSharedRuntime,
  startLanServer,
  validLanEndpoint,
} from "../src/web/lan";
import { createWebHost } from "../src/web/server";
import { rendererCspForOrigin } from "../src/web/static";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup.length = 0;
});

// Node's fetch rewrites the Host header, so these tests use http.request to
// exercise the DNS-rebinding protection exactly as a browser would send it.
function call(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  return new Promise((done, reject) => {
    const req = request(
      url,
      { method: init.method ?? "GET", headers: init.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          done(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: res.headers as Record<string, string>,
            }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>((done) => probe.close(() => done()));
  return address.port;
}

function provider() {
  return {
    listModels: async () => ["lan-fixture"],
    complete: async (
      messages: readonly { role: string; content: string | null }[],
      _tools: unknown,
      options: { onText: (text: string) => void; signal?: AbortSignal },
    ) => {
      options.onText("lan fixture response");
      if (messages.some((message) => message.content === "wait for lan stop"))
        await new Promise<void>((done) => {
          if (options.signal?.aborted) return done();
          options.signal?.addEventListener("abort", () => done(), {
            once: true,
          });
        });
      return {
        message: {
          role: "assistant" as const,
          content: "lan fixture response",
        },
      };
    },
  };
}

async function setup(
  options: { restrictWorkspace?: boolean; renderer?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "forge-lan-test-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const service = await createHarness({
    stateDir: join(directory, "state"),
    providerFactory: () => provider(),
  });
  await service.updateSettings({
    settings: { baseUrl: "http://localhost:1234/v1", model: "lan-fixture" },
  });
  const runtime = createRuntimeHub(service);
  cleanup.push(() => runtime.dispose());
  let rendererRoot: string | undefined;
  if (options.renderer) {
    rendererRoot = join(directory, "renderer");
    await mkdir(join(rendererRoot, "assets"), { recursive: true });
    await writeFile(
      join(rendererRoot, "index.html"),
      "<!DOCTYPE html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'none';\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"./assets/index.js\"></script></body></html>",
    );
    await writeFile(
      join(rendererRoot, "assets", "index.js"),
      "console.log('renderer');",
    );
  }
  return { directory, service, runtime, rendererRoot };
}

/**
 * An empty renderer directory: hosting works without any built asset, which is
 * what a missing or mis-ordered build produces. Page requests then 404.
 */
async function emptyRenderer(directory: string): Promise<string> {
  const root = join(directory, "empty-renderer");
  await mkdir(root, { recursive: true });
  return root;
}

const headers = (origin: string, clientId?: string) => ({
  Host: origin.replace("http://", ""),
  Origin: origin,
  "Content-Type": "application/json",
  ...(clientId ? { "X-Forge-Client": clientId } : {}),
});

async function connect(origin: string) {
  const response = await call(`${origin}/api/connect`, {
    method: "POST",
    headers: headers(origin),
    body: "{}",
  });
  expect(response.status).toBe(200);
  const handshake = z
    .object({
      clientId: z.string(),
      workspace: z.string(),
      recovery: z.array(runEventSchema),
    })
    .parse(await response.json());
  return handshake;
}

async function stream(origin: string, clientId: string): Promise<RunEvent[]> {
  const ws = new WebSocket(
    `${origin.replace("http:", "ws:")}/api/events?clientId=${clientId}&cursor=0`,
    { headers: { Origin: origin } },
  );
  const received: RunEvent[] = [];
  cleanup.push(async () => ws.terminate());
  await new Promise<void>((done, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const batch = z
        .object({ cursor: z.number(), events: z.array(runEventSchema) })
        .parse(JSON.parse(raw.toString()));
      received.push(...batch.events);
      ws.send(JSON.stringify({ cursor: batch.cursor }));
      done();
    });
  });
  return received;
}

describe("LAN host", () => {
  it("only accepts a concrete IPv4 address and a legal port", () => {
    expect(validLanEndpoint("192.168.1.5", 5173)).toBe(true);
    expect(validLanEndpoint("127.0.0.1", 1024)).toBe(true);
    for (const [host, port] of [
      ["0.0.0.0", 5173],
      ["localhost", 5173],
      ["::", 5173],
      ["192.168.1.5", 80],
      ["192.168.1.5", 70000],
    ] as const)
      expect(validLanEndpoint(host, port)).toBe(false);
  });

  it("stops listening without cancelling a run and keeps the shared runtime usable", async () => {
    const { directory, runtime } = await setup();
    const rendererRoot = await emptyRenderer(directory);
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const lan = await startLanServer({
      runtime,
      host: "127.0.0.1",
      port,
      workspace: directory,
      restrictWorkspace: true,
      rendererRoot,
    });
    cleanup.push(() => lan.close());
    const handshake = await connect(origin);
    const events = await stream(origin, handshake.clientId);
    const post = (path: string, body: object) =>
      call(`${origin}${path}`, {
        method: "POST",
        headers: headers(origin, handshake.clientId),
        body: JSON.stringify(body),
      });
    const created = z
      .object({ ok: z.literal(true), result: z.object({ id: z.string() }) })
      .parse(
        await (
          await post("/api/rpc", {
            id: randomUUID(),
            method: "createSession",
            input: { workspace: directory, model: "lan-fixture" },
          })
        ).json(),
      );
    const started = z
      .object({ ok: z.literal(true), result: z.object({ runId: z.string() }) })
      .parse(
        await (
          await post("/api/rpc", {
            id: randomUUID(),
            method: "startRun",
            input: {
              sessionId: created.result.id,
              prompt: "wait for lan stop",
              permission: "readonly",
            },
          })
        ).json(),
      );

    // The listener goes away, but the run and the one shared runtime do not.
    await expect
      .poll(() => events.some((item) => item.runId === started.result.runId))
      .toBe(true);
    await lan.close();
    await expect(
      call(`${origin}/api/connect`, {
        method: "POST",
        headers: headers(origin),
        body: "{}",
      }),
    ).rejects.toThrow();
    expect(events.some((item) => item.runId === started.result.runId)).toBe(
      true,
    );

    const [sessionId, runId] = [created.result.id, started.result.runId];
    const snapshot = await runtime.request({
      id: randomUUID(),
      method: "getSession",
      sessionId,
    } as never);
    expect(snapshot.ok).toBe(true);
    const cancelled = await runtime.request({
      id: randomUUID(),
      method: "cancelRun",
      runId,
    } as never);
    expect(cancelled.ok).toBe(true);
    await expect
      .poll(async () => {
        const current = await runtime.request({
          id: randomUUID(),
          method: "getSession",
          sessionId,
        } as never);
        return current.ok && current.method === "getSession"
          ? current.result.status
          : "unknown";
      })
      .toMatch(/cancelled|idle|completed/);
  });

  it("serves the packaged renderer with only connect-src relaxed and refuses escapes", async () => {
    const { directory, runtime, rendererRoot } = await setup({
      renderer: true,
    });
    if (!rendererRoot) throw new Error("missing renderer");
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const lan = await startLanServer({
      runtime,
      host: "127.0.0.1",
      port,
      workspace: directory,
      restrictWorkspace: true,
      rendererRoot,
    });
    cleanup.push(() => lan.close());
    const accept = { Host: `127.0.0.1:${port}` };

    const index = await call(`${origin}/`, { headers: accept });
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await index.text();
    // HTTP and the explicit socket origin are added; the other CSP rules stay.
    expect(html).toContain(`connect-src 'self' ws://127.0.0.1:${port};`);
    expect(html).not.toContain("connect-src 'none'");
    expect(html).toContain("default-src 'self';");
    expect(html).toContain("script-src 'self';");
    expect(html).toContain("style-src 'self' 'unsafe-inline';");
    // Relative asset URLs still resolve: base-relative paths are issued.
    expect(html).toContain('src="/assets/index.js"');

    const asset = await call(`${origin}/assets/index.js`, { headers: accept });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(await asset.text()).toBe("console.log('renderer');");

    const outside = join(directory, "secret.html");
    await writeFile(outside, "secret");
    await symlink(outside, join(rendererRoot, "leak.html"));
    for (const path of [
      "/../secret.html",
      "/%2e%2e/secret.html",
      "/leak.html",
      "/assets",
      "/.hidden",
      "/missing.js",
    ]) {
      const response = await call(`${origin}${path}`, { headers: accept });
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain("secret");
    }
  });

  it("keeps multi-workspace mode permissive but refuses ambiguous file previews", async () => {
    const { directory, service, runtime } = await setup();
    const other = await mkdtemp(join(tmpdir(), "forge-lan-other-"));
    cleanup.push(() => rm(other, { recursive: true, force: true }));
    const rendererRoot = await emptyRenderer(directory);
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const lan = await startLanServer({
      runtime,
      host: "127.0.0.1",
      port,
      workspace: directory,
      restrictWorkspace: false,
      rendererRoot,
    });
    cleanup.push(() => lan.close());
    const handshake = await connect(origin);
    const post = (path: string, body: object) =>
      call(`${origin}${path}`, {
        method: "POST",
        headers: headers(origin, handshake.clientId),
        body: JSON.stringify(body),
      });
    await stream(origin, handshake.clientId);

    // Another project's session is visible and usable in desktop LAN mode.
    const foreign = await service.createSession({
      workspace: other,
      title: "other",
    });
    const fetched = await post("/api/rpc", {
      id: randomUUID(),
      method: "getSession",
      sessionId: foreign.id,
    });
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).result.workspace).toBe(other);
    const listed = await post("/api/rpc", {
      id: randomUUID(),
      method: "listSessions",
    });
    expect(JSON.stringify(await listed.json())).toContain(other);

    // The path-only preview contract cannot say which project it means.
    await writeFile(join(directory, "page.html"), "<p>launch project</p>");
    const preview = await post("/api/preview/file", { path: "page.html" });
    expect(preview.status).toBe(403);

    // Launching in another workspace is allowed here, unlike restricted mode.
    const created = await post("/api/rpc", {
      id: randomUUID(),
      method: "createSession",
      input: { workspace: other, title: "remote", model: "lan-fixture" },
    });
    expect(created.status).toBe(200);
  });

  it("restricted Web mode still refuses foreign workspaces on read and write", async () => {
    const { directory, service } = await setup();
    const other = await mkdtemp(join(tmpdir(), "forge-lan-restricted-"));
    cleanup.push(() => rm(other, { recursive: true, force: true }));
    const port = await freePort();
    const web = await createWebHost({
      service,
      workspace: directory,
      host: "127.0.0.1",
      port,
      restrictWorkspace: true,
    });
    web.server.on("request", (req, res) => {
      void web.handle(req, res, () => {
        res.writeHead(200);
        res.end("next");
      });
    });
    await new Promise<void>((done) =>
      web.server.listen(port, "127.0.0.1", done),
    );
    cleanup.push(() => web.close());
    const origin = `http://127.0.0.1:${port}`;
    const handshake = await connect(origin);
    const post = (path: string, body: object) =>
      call(`${origin}${path}`, {
        method: "POST",
        headers: headers(origin, handshake.clientId),
        body: JSON.stringify(body),
      });
    const foreign = await service.createSession({
      workspace: other,
      title: "outside",
    });
    const read = await post("/api/rpc", {
      id: randomUUID(),
      method: "getSession",
      sessionId: foreign.id,
    });
    expect(read.status).toBe(403);
    const create = await post("/api/rpc", {
      id: randomUUID(),
      method: "createSession",
      input: { workspace: other },
    });
    expect(create.status).toBe(403);
    // Pairing is address discovery only: the page's own origin and workspace.
    const pairing = await post("/api/pairing", {});
    expect(pairing.status).toBe(200);
    expect(await pairing.json()).toEqual({ url: origin, workspace: directory });
  });

  it("serializes start and stop so a stop cannot race a half-bound listener", async () => {
    const { directory, runtime } = await setup();
    const rendererRoot = await emptyRenderer(directory);
    const report = vi.fn();
    const ports = [await freePort(), await freePort()];
    const controller = createLanHostController({
      report,
      start: (input) =>
        startLanServer({
          ...input,
          runtime,
          rendererRoot,
        }),
    });
    // Fire concurrently: the queue must apply them in order, never interleaved.
    const started = controller
      .start({
        host: "127.0.0.1",
        port: ports[0] as number,
        workspace: directory,
      })
      .then((url) => ({ url, at: "start" }));
    const stopped = controller.stop().then((url) => ({ url, at: "stop" }));
    const results = await Promise.all([started, stopped]);
    expect(results[0]).toMatchObject({ at: "start" });
    expect((results[0] as { url: string | null }).url).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:${ports[0]}$`),
    );
    expect(results[1]).toEqual({ url: null, at: "stop" });
    expect(controller.status().url).toBeNull();
    // The port is free again: nothing was left half-bound.
    await expect(
      startLanServer({
        runtime,
        host: "127.0.0.1",
        port: ports[0] as number,
        workspace: directory,
        restrictWorkspace: true,
        rendererRoot,
      }),
    ).resolves.toMatchObject({ url: `http://127.0.0.1:${ports[0]}` });
    await controller.dispose();
    expect(report).not.toHaveBeenCalled();
  });

  it("rejects 0.0.0.0 before binding even through the controller", async () => {
    const { directory, runtime } = await setup();
    const rendererRoot = await emptyRenderer(directory);
    const controller = createLanHostController({
      report: () => {},
      start: (input) =>
        startLanServer({
          ...input,
          runtime,
          rendererRoot,
        }),
    });
    await expect(
      controller.start({ host: "0.0.0.0", port: 5173, workspace: directory }),
    ).rejects.toThrow(/concrete IPv4/);
    await controller.dispose();
  });

  it("reports and rethrows a listener that will not close", async () => {
    const { directory } = await setup();
    const report = vi.fn();
    let open = true;
    const controller = createLanHostController({
      report,
      start: async (input) => ({
        url: `http://${input.host}:${input.port}`,
        workspace: input.workspace,
        close: async () => {
          if (open) {
            open = false;
            throw new Error("socket still open");
          }
        },
      }),
    });
    await controller.start({
      host: "127.0.0.1",
      port: 5173,
      workspace: directory,
    });
    await expect(controller.stop()).rejects.toThrow("socket still open");
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("socket still open"),
    );
    expect(controller.status().url).toBeNull();
  });

  it("disposes the shared runtime even when the LAN listener fails to close", async () => {
    const report = vi.fn();
    const order: string[] = [];
    const clean = await shutdownSharedRuntime({
      closeLan: async () => {
        order.push("lan");
        throw new Error("socket still open");
      },
      disposeRuntime: async () => {
        order.push("runtime");
      },
      report,
    });
    // Runtime disposal still happened, and the shutdown is reported unclean.
    expect(order).toEqual(["lan", "runtime"]);
    expect(clean).toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.stringContaining("socket still open"),
    );
  });

  it("reports a clean shutdown only when both steps succeed", async () => {
    const report = vi.fn();
    const order: string[] = [];
    await expect(
      shutdownSharedRuntime({
        closeLan: async () => {
          order.push("lan");
        },
        disposeRuntime: async () => {
          order.push("runtime");
        },
        report,
      }),
    ).resolves.toBe(true);
    // LAN closes before the shared runtime is released.
    expect(order).toEqual(["lan", "runtime"]);
    expect(report).not.toHaveBeenCalled();
  });

  it("leaves a caller-owned runtime alive when the Web host closes", async () => {
    const { directory, runtime } = await setup();
    const port = await freePort();
    const web = await createWebHost({
      runtime,
      workspace: directory,
      host: "127.0.0.1",
      port,
      restrictWorkspace: true,
    });
    expect(web.ownsRuntime).toBe(false);
    web.server.on("request", (req, res) => {
      void web.handle(req, res, () => res.end());
    });
    await new Promise<void>((done) =>
      web.server.listen(port, "127.0.0.1", done),
    );
    await web.close();
    const settings = await runtime.request({
      id: randomUUID(),
      method: "getSettings",
    } as never);
    expect(settings.ok).toBe(true);
  });

  it("relaxes only connect-src in the shipped CSP text", () => {
    const original =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'none';";
    expect(rendererCspForOrigin(original, "http://192.168.1.9:5173")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' ws://192.168.1.9:5173;",
    );
  });

  it("starts and stops LAN from the worker over one shared runtime", async () => {
    // The real worker entry point, bundled to a temp dir so its sibling
    // `../renderer` is a directory this test controls.
    const root = await mkdtemp(join(tmpdir(), "forge-lan-worker-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const desktop = join(root, "desktop");
    const renderer = join(root, "renderer");
    await mkdir(desktop, { recursive: true });
    await mkdir(renderer, { recursive: true });
    await writeFile(
      join(renderer, "index.html"),
      "<!DOCTYPE html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; connect-src 'none';\"></head><body>lan worker</body></html>",
    );
    const { build } = await import("esbuild");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/desktop/worker.ts", import.meta.url)),
      ],
      outfile: join(desktop, "worker.cjs"),
      bundle: true,
      platform: "node",
      target: "node22",
      format: "cjs",
      // Mirror scripts/build.mjs: native and heavy packages stay external, so
      // the worker resolves them from node_modules at run time.
      external: ["electron", "playwright", "playwright-core"],
      logLevel: "silent",
    });

    const workspace = await mkdtemp(join(tmpdir(), "forge-lan-workspace-"));
    cleanup.push(() => rm(workspace, { recursive: true, force: true }));
    const state = join(root, "state");
    const { Worker } = await import("node:worker_threads");
    const child = new Worker(join(desktop, "worker.cjs"), {
      env: { ...process.env, FORGE_HOME: state },
    });
    cleanup.push(() => child.terminate());
    type Message = {
      kind?: string;
      control?: string;
      id?: string;
      url?: string | null;
      error?: string;
    };
    const messages: Message[] = [];
    const waiters: ((message: Message) => void)[] = [];
    child.on("message", (raw: Message) => {
      messages.push(raw);
      for (const waiter of waiters.splice(0)) waiter(raw);
    });
    const next = (match: (message: Message) => boolean): Promise<Message> => {
      const found = messages.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((done) => {
        const waiter = (message: Message) => {
          if (match(message)) done(message);
          else waiters.push(waiter);
        };
        waiters.push(waiter);
      });
    };
    const waitFor = (predicate: () => boolean, label: string) =>
      vi.waitFor(() => expect(predicate(), label).toBe(true), {
        timeout: 15000,
      });

    await next((message) => message.kind === "ready");
    const port = await freePort();
    const startId = randomUUID();
    child.postMessage({
      control: "startLan",
      id: startId,
      host: "127.0.0.1",
      port,
      workspace,
    });
    const started = await next(
      (message) => message.control === "lanResult" && message.id === startId,
    );
    expect(started.error).toBeUndefined();
    expect(started.url).toBe(`http://127.0.0.1:${port}`);

    // The same runtime serves the page: a session created over HTTP is visible
    // to the worker's controller, and events from it reach the parent.
    const origin = started.url as string;
    const handshake = await connect(origin);
    const created = z
      .object({ ok: z.literal(true), result: z.object({ id: z.string() }) })
      .parse(
        await (
          await call(`${origin}/api/rpc`, {
            method: "POST",
            headers: headers(origin, handshake.clientId),
            body: JSON.stringify({
              id: randomUUID(),
              method: "createSession",
              input: { workspace, model: "not-configured" },
            }),
          })
        ).json(),
      );
    expect(created.result.id).toEqual(expect.any(String));
    const fetched = await call(`${origin}/api/pairing`, {
      method: "POST",
      headers: headers(origin, handshake.clientId),
      body: "{}",
    });
    expect(await fetched.json()).toEqual({ url: origin, workspace });
    // The packaged renderer is served by the worker-owned LAN host.
    const index = await call(`${origin}/`, {
      headers: { Host: `127.0.0.1:${port}` },
    });
    expect(index.status).toBe(200);
    expect(await index.text()).toContain(
      `connect-src 'self' ws://127.0.0.1:${port};`,
    );

    // Stopping LAN leaves the worker and the shared runtime alive.
    const stopId = randomUUID();
    child.postMessage({ control: "stopLan", id: stopId });
    const stopped = await next(
      (message) => message.control === "lanResult" && message.id === stopId,
    );
    expect(stopped).toMatchObject({ url: null });
    await expect(
      call(`${origin}/api/connect`, {
        method: "POST",
        headers: headers(origin),
        body: "{}",
      }),
    ).rejects.toThrow();

    // The controller still answers directly after the listener is gone.
    const settingsId = randomUUID();
    child.postMessage({ id: settingsId, method: "getSettings" });
    await waitFor(
      () =>
        messages.some(
          (message) =>
            message.kind === "response" &&
            (message as unknown as { response?: { id?: string } }).response
              ?.id === settingsId,
        ),
      "getSettings response after LAN stop",
    );

    const shutdownId = randomUUID();
    child.postMessage({ control: "shutdown", id: shutdownId });
    const ack = await next(
      (message) =>
        message.control === "shutdownAck" && message.id === shutdownId,
    );
    expect(ack).toMatchObject({ clean: true });
  }, 60000);
});
