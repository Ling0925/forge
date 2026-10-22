#!/usr/bin/env node
/**
 * Offline Forge Core fixture for the Android native client.
 *
 * Real: Core's built Web host (`dist/web/server.js`) and its controller/runtime
 * host (`dist/host/runtime.js`), including HTTP RPC, WebSocket events, run
 * cancellation and the approval handshake.
 *
 * Fake: one in-memory `HarnessService`. It never reads Forge configuration,
 * sessions, provider credentials or the network. All generated files live
 * under android/.gradle/native-fixture/ and are removed on Ctrl+C/SIGTERM.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 18765;
const MODEL = "fixture-offline";
const DELTA_DELAY_MS = 35;
const SLOW_TIMEOUT_MS = 120_000;

const ANDROID_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORE_ROOT = fileURLToPath(
  new URL("../../repos/forge-core/", import.meta.url),
);
const CORE_SERVER = join(CORE_ROOT, "dist/web/server.js");
const CORE_RUNTIME = join(CORE_ROOT, "dist/host/runtime.js");

function usage() {
  console.log(`Offline Forge Core fixture for the Android native client.

Usage:
  node tests/native-core-fixture.mjs [--port 18765]

Defaults:
  listen  ${HOST}:${DEFAULT_PORT} (loopback only; use adb reverse for the emulator)
  model   ${MODEL} (in-memory fake; no provider request)
  state   android/.gradle/native-fixture/run-<pid>-<random>/ (removed on stop)

The fixture is API-only. It has no renderer, no pairing and no authentication.
Use 127.0.0.1, not localhost, from the emulator so the Host header matches.
Press Ctrl+C to close the host and remove its generated state.`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function portFromArguments() {
  const raw = argument("--port");
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }
  return port;
}

function timestamp() {
  return new Date().toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function splitText(text) {
  return text.match(/[\s\S]{1,24}/g) ?? [text];
}

function sleepUnlessAborted(signal, milliseconds) {
  return new Promise((done) => {
    if (signal.aborted) {
      done(true);
      return;
    }
    let settled = false;
    const finish = (aborted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      done(aborted);
    };
    const onAbort = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAbort(signal, milliseconds) {
  return new Promise((done) => {
    if (signal.aborted) {
      done(true);
      return;
    }
    let settled = false;
    const finish = (aborted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      done(aborted);
    };
    const onAbort = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function answerFor(prompt, imageCount) {
  if (prompt.toLowerCase() === "hello") {
    return "Hello from the offline Forge Core fixture.";
  }
  if (!prompt) {
    return `收到 ${imageCount} 张图片；离线 fixture 不读取图片内容。`;
  }
  const shown = prompt.length > 500 ? `${prompt.slice(0, 500)}…` : prompt;
  return `收到：「${shown}」\n这是来自离线 Forge Core fixture 的流式回复，未调用真实模型。`;
}

function createFakeService(workspace) {
  const sessions = new Map();
  let settings = {
    baseUrl: "http://127.0.0.1:1/v1",
    model: MODEL,
    theme: "system",
    defaultPermission: "workspace",
    maxTurns: 20,
    maxToolCalls: 100,
    requestTimeoutMs: 60_000,
    contextBudgetChars: 100_000,
    browserAllowedOrigins: [],
    browserExecutablePath: "",
    hasApiKey: false,
    isConfigured: true,
  };
  let disposed = false;

  const requireSession = (id) => {
    const session = sessions.get(id);
    if (!session) throw new Error("Unknown native fixture session.");
    return session;
  };

  const summaryOf = (session) => ({
    version: session.version,
    id: session.id,
    title: session.title,
    workspace: session.workspace,
    model: session.model,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    ...(session.archived === undefined ? {} : { archived: session.archived }),
  });

  const eventFor = (session, type, extra) => ({
    sessionId: session.id,
    timestamp: timestamp(),
    type,
    ...extra,
  });

  const pushEvent = (session, onEvent, event) => {
    onEvent(event);
    session.events.push(event);
    return event;
  };

  const emitGenerationFinished = (
    session,
    onEvent,
    generationId,
    turn,
    status,
  ) => {
    pushEvent(
      session,
      onEvent,
      eventFor(session, "generation_finished", {
        generationId,
        status,
        turn,
      }),
    );
  };

  const finishCompleted = (
    session,
    onEvent,
    { generationId, turn, answer, toolCalls, generationFinished },
  ) => {
    if (!generationFinished) {
      emitGenerationFinished(session, onEvent, generationId, turn, "completed");
    }
    const messageIndex = session.messages.length;
    session.messages.push({
      role: "assistant",
      content: answer,
      generationId,
    });
    session.status = "completed";
    session.updatedAt = timestamp();
    pushEvent(
      session,
      onEvent,
      eventFor(session, "run_finished", {
        status: "completed",
        turn,
        turns: 1,
        toolCalls,
        messageIndex,
      }),
    );
    return clone(session);
  };

  const finishCancelled = (
    session,
    onEvent,
    { generationId, turn, generationFinished, toolCalls = 0 },
  ) => {
    if (!generationFinished) {
      emitGenerationFinished(session, onEvent, generationId, turn, "cancelled");
    }
    session.status = "cancelled";
    session.updatedAt = timestamp();
    pushEvent(
      session,
      onEvent,
      eventFor(session, "run_finished", {
        status: "cancelled",
        turn,
        turns: 1,
        toolCalls,
      }),
    );
    return clone(session);
  };

  const runApproval = async (
    session,
    onEvent,
    approve,
    signal,
    generationId,
    turn,
  ) => {
    pushEvent(
      session,
      onEvent,
      eventFor(session, "text_delta", {
        generationId,
        turn,
        text: "正在请求一次离线工具审批。",
      }),
    );
    emitGenerationFinished(session, onEvent, generationId, turn, "completed");

    const toolCallId = randomUUID();
    const request = {
      id: randomUUID(),
      sessionId: session.id,
      toolCallId,
      toolName: "write_file",
      description:
        "Offline native fixture: approve a simulated write_file call. No real tool runtime or provider is involved.",
      command: ["echo", "offline-native-fixture-approved"],
    };
    session.status = "awaiting_approval";
    session.updatedAt = timestamp();
    pushEvent(
      session,
      onEvent,
      eventFor(session, "approval_requested", { request, turn }),
    );

    const approved = await approve(request, signal);
    if (signal.aborted) {
      return finishCancelled(session, onEvent, {
        generationId,
        turn,
        generationFinished: true,
      });
    }

    const call = {
      id: toolCallId,
      type: "function",
      function: {
        name: "write_file",
        arguments: JSON.stringify({
          path: "fixture-approval.txt",
          content: "offline native fixture approval\n",
        }),
      },
    };
    pushEvent(
      session,
      onEvent,
      eventFor(session, "tool_started", { call, turn }),
    );

    let result;
    if (approved) {
      try {
        await writeFile(
          join(session.workspace, "fixture-approval.txt"),
          "offline native fixture approval\n",
          "utf8",
        );
        result = {
          content:
            "wrote fixture-approval.txt in the isolated fixture workspace",
          isError: false,
        };
      } catch {
        result = {
          content: "could not write the isolated fixture file",
          isError: true,
        };
      }
    } else {
      result = {
        content: "approval denied; no fixture file was written",
        isError: true,
      };
    }
    pushEvent(
      session,
      onEvent,
      eventFor(session, "tool_finished", { toolCallId, result, turn }),
    );

    return finishCompleted(session, onEvent, {
      generationId,
      turn,
      generationFinished: true,
      toolCalls: 1,
      answer: approved
        ? "已完成离线审批：模拟工具在隔离工作区写入了 fixture-approval.txt。"
        : "离线工具审批被拒绝；没有写入 fixture 文件。",
    });
  };

  const runSlow = async (session, onEvent, signal, generationId, turn) => {
    pushEvent(
      session,
      onEvent,
      eventFor(session, "text_delta", {
        generationId,
        turn,
        text: "slow fixture：正在等待 cancelRun（最多 120 秒）。",
      }),
    );
    const aborted = await waitForAbort(signal, SLOW_TIMEOUT_MS);
    if (aborted) {
      return finishCancelled(session, onEvent, {
        generationId,
        turn,
        generationFinished: false,
      });
    }
    return finishCompleted(session, onEvent, {
      generationId,
      turn,
      generationFinished: false,
      toolCalls: 0,
      answer: "slow fixture window elapsed without cancelRun.",
    });
  };

  return {
    async getSettings() {
      return clone(settings);
    },

    async updateSettings(input) {
      settings = {
        ...settings,
        ...(input.settings ?? {}),
        hasApiKey: false,
      };
      settings.isConfigured = settings.baseUrl !== "" && settings.model !== "";
      return clone(settings);
    },

    async listModels() {
      return [MODEL];
    },

    async listSessions() {
      return [...sessions.values()]
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.id.localeCompare(right.id),
        )
        .map(summaryOf);
    },

    async createSession(input) {
      const now = timestamp();
      const session = {
        version: 1,
        id: randomUUID(),
        title: input.title ?? `Native fixture ${sessions.size + 1}`,
        workspace: resolve(input.workspace),
        model: input.model || settings.model,
        createdAt: now,
        updatedAt: now,
        status: "idle",
        messages: [],
        events: [],
        changes: [],
        titleSource: input.title ? "user" : "default",
      };
      sessions.set(session.id, session);
      return clone(session);
    },

    async getSession(id) {
      return clone(requireSession(id));
    },

    async renameSession(id, title) {
      const session = requireSession(id);
      session.title = title;
      session.titleSource = "user";
      session.updatedAt = timestamp();
      return clone(session);
    },

    async archiveSession(id, archived) {
      const session = requireSession(id);
      session.archived = archived;
      session.updatedAt = timestamp();
      return clone(session);
    },

    async compactSession(id) {
      return clone(requireSession(id));
    },

    async cancelSession() {
      // Active runs are stopped through the public `cancelRun` RPC.
      return false;
    },

    async getProjectContext(id) {
      const session = requireSession(id);
      return {
        workspace: session.workspace,
        instructionSources: [],
        skills: [],
        warnings: [],
        counts: { instructions: 0, skills: 0, warnings: 0 },
      };
    },

    async getDiagnostics(id) {
      const session = requireSession(id);
      const transcriptChars = session.messages.reduce(
        (total, message) =>
          total +
          (typeof message.content === "string" ? message.content.length : 0),
        0,
      );
      return {
        transcriptChars,
        projectedChars: transcriptChars,
        messageCount: session.messages.length,
        summaryFallback: false,
      };
    },

    async getUsageStats() {
      const totalRuns = [...sessions.values()].reduce(
        (total, session) =>
          total +
          session.events.filter((event) => event.type === "run_started").length,
        0,
      );
      return {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCachedTokens: 0,
        totalTokens: 0,
        totalSessions: sessions.size,
        totalRuns,
        averageCacheRate: 0,
        models: [],
        daily: [],
        topSessions: [],
      };
    },

    async listMcpServers() {
      return [];
    },

    async removeMcpServer() {
      return undefined;
    },

    async listCheckpoints() {
      return [];
    },

    async getCheckpointDiff() {
      return "";
    },

    async restoreCheckpoint() {
      throw new Error("Checkpoints are not available in the native fixture.");
    },

    async run(input, onEvent, approve, signal) {
      if (disposed) throw new Error("The native fixture service is closed.");
      const session = requireSession(input.sessionId);
      const rawPrompt = input.prompt ?? "";
      const prompt = rawPrompt.trim();
      const images = input.images ?? [];
      const turn =
        session.events.filter((event) => event.type === "run_started").length +
        1;
      const userIndex = session.messages.length;
      session.messages.push({
        role: "user",
        content: rawPrompt,
        ...(images.length ? { images } : {}),
      });
      const permission = input.permission ?? settings.defaultPermission;
      const model = input.model || session.model || settings.model;
      const generationId = randomUUID();

      session.model = model;
      session.status = "running";
      session.updatedAt = timestamp();
      pushEvent(
        session,
        onEvent,
        eventFor(session, "run_started", {
          turn,
          messageIndex: userIndex,
          model,
          permission,
        }),
      );
      pushEvent(
        session,
        onEvent,
        eventFor(session, "generation_started", {
          generationId,
          // Core runtime anchors the assistant at the next durable message index.
          messageIndex: session.messages.length,
          turn,
        }),
      );

      try {
        if (prompt.toLowerCase() === "approval") {
          return await runApproval(
            session,
            onEvent,
            approve,
            signal,
            generationId,
            turn,
          );
        }
        if (prompt.toLowerCase() === "slow") {
          return await runSlow(session, onEvent, signal, generationId, turn);
        }

        const answer = answerFor(prompt, images.length);
        for (const chunk of splitText(answer)) {
          if (await sleepUnlessAborted(signal, DELTA_DELAY_MS)) {
            return finishCancelled(session, onEvent, {
              generationId,
              turn,
              generationFinished: false,
            });
          }
          pushEvent(
            session,
            onEvent,
            eventFor(session, "text_delta", {
              generationId,
              turn,
              text: chunk,
            }),
          );
        }
        if (signal.aborted) {
          return finishCancelled(session, onEvent, {
            generationId,
            turn,
            generationFinished: false,
          });
        }
        return finishCompleted(session, onEvent, {
          generationId,
          turn,
          generationFinished: false,
          toolCalls: 0,
          answer,
        });
      } catch (error) {
        session.status = "failed";
        session.updatedAt = timestamp();
        throw error;
      }
    },

    async dispose() {
      disposed = true;
    },
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const port = portFromArguments();
  if (!existsSync(CORE_SERVER) || !existsSync(CORE_RUNTIME)) {
    console.error(
      `[native-core-fixture] Forge Core build is missing: ${CORE_SERVER}`,
    );
    console.error("Build it first (this fixture does not modify Core):");
    console.error("  (cd ../repos/forge-core && pnpm build)");
    process.exitCode = 1;
    return;
  }

  const runRoot = join(
    ANDROID_ROOT,
    ".gradle",
    "native-fixture",
    `run-${process.pid}-${randomUUID().slice(0, 8)}`,
  );
  const workspace = join(runRoot, "workspace");
  const stateDirectory = join(runRoot, "state");
  await mkdir(workspace, { recursive: true });
  await mkdir(stateDirectory, { recursive: true });
  // Do not let any incidental Core state discovery touch the real user home.
  process.env.FORGE_HOME = stateDirectory;

  const { createWebHost } = await import(pathToFileURL(CORE_SERVER).href);
  const { createRuntimeHub } = await import(pathToFileURL(CORE_RUNTIME).href);

  const service = createFakeService(workspace);
  const runtime = createRuntimeHub(service);
  let web;
  let shuttingDown = false;

  const cleanup = async () => {
    try {
      await web?.dispose();
    } finally {
      try {
        await runtime.dispose();
      } finally {
        await rm(runRoot, { recursive: true, force: true });
        // Remove only the now-empty parent; other fixture runs are unaffected.
        await rmdir(dirname(runRoot)).catch(() => undefined);
      }
    }
  };

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[native-core-fixture] stopping (${signal})`);
    try {
      await cleanup();
    } catch (error) {
      console.error(
        `[native-core-fixture] cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    web = await createWebHost({
      runtime,
      workspace,
      host: HOST,
      port,
      stateDir: stateDirectory,
      trustedLan: true,
      restrictWorkspace: true,
    });
    web.server.on("request", (request, response) => {
      void web
        .handle(request, response, () => {
          if (response.headersSent) return;
          response.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8",
          });
          response.end("native-core-fixture: API only\n");
        })
        .catch(() => {
          if (response.headersSent) response.destroy();
          else {
            response.writeHead(500, {
              "Content-Type": "text/plain; charset=utf-8",
            });
            response.end("native-core-fixture: internal error\n");
          }
        });
    });

    await new Promise((done, reject) => {
      const onError = (error) => {
        web.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        web.server.off("error", onError);
        done();
      };
      web.server.once("error", onError);
      web.server.once("listening", onListening);
      web.server.listen(port, HOST);
    });

    const relativeState = join(
      ".gradle",
      "native-fixture",
      runRoot.slice(runRoot.lastIndexOf("run-")),
    );
    console.log("[native-core-fixture] ready");
    console.log(`  origin: ${web.origin}`);
    console.log("  mode: trustedLan API-only (no pairing, no auth)");
    console.log(`  model: ${MODEL} (offline fake; no provider calls)`);
    console.log(`  state: ${relativeState} (removed on stop)`);
    console.log(
      `  android: adb reverse tcp:${port} tcp:${port} && use http://${HOST}:${port}/`,
    );
    console.log(
      "  prompts: hello | any 中文 text -> stream; approval -> tool approval; slow -> cancelRun test",
    );
    console.log("  stop: Ctrl+C");
  } catch (error) {
    console.error(
      `[native-core-fixture] failed to start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await cleanup().catch(() => undefined);
    process.exitCode = 1;
  }
}

await main();
