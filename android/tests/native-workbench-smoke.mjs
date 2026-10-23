#!/usr/bin/env node
/**
 * HTTP/WebSocket smoke test for the offline native Core fixture.
 *
 * Starts tests/native-core-fixture.mjs on a temporary loopback port (18766 by
 * default), exercises the real Core routes/controller with the fake service, and
 * always terminates the child and removes its fixture run directory.
 *
 * Run: node tests/native-workbench-smoke.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ANDROID_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CORE_ROOT = fileURLToPath(
  new URL("../../repos/forge-core/", import.meta.url),
);
const FIXTURE_SCRIPT = join(ANDROID_ROOT, "tests", "native-core-fixture.mjs");
const PORT = Number(process.env.NATIVE_FIXTURE_PORT ?? 18766);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WS_ORIGIN = `ws://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 20_000;
const RUN_TIMEOUT_MS = 20_000;

const requireFromCore = createRequire(join(CORE_ROOT, "package.json"));
const WebSocket = requireFromCore("ws");

async function importCore(relativePath) {
  return import(pathToFileURL(join(CORE_ROOT, "dist", relativePath)).href);
}

const [
  { publicSettingsSchema, sessionSnapshotSchema },
  {
    usageStatsDtoSchema,
    workspaceDirectoryListingDtoSchema,
    workspaceFilePreviewDtoSchema,
  },
  { checkpointDtoSchema },
  { mcpHealthDtoSchema, mcpRecordDtoSchema },
  { inputQueueSnapshotSchema, queuedInputSchema },
  { projectContextDtoSchema },
  { hostStateSchema },
] = await Promise.all([
  importCore("shared/schemas.js"),
  importCore("shared/ipc.js"),
  importCore("shared/checkpoints.js"),
  importCore("shared/mcp.js"),
  importCore("shared/input-queue.js"),
  importCore("shared/project-context.js"),
  importCore("shared/host.js"),
]);

function sleep(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function parse(schema, value, label) {
  try {
    return schema.parse(value);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

let fixture;
let events;
let clientId;

function log(message) {
  console.log(`[native-workbench-smoke] ${message}`);
}

async function startFixture() {
  if (!existsSync(join(CORE_ROOT, "dist/web/server.js"))) {
    throw new Error(
      `Forge Core build is missing at ${CORE_ROOT}/dist; build Core first.`,
    );
  }
  if (!existsSync(FIXTURE_SCRIPT)) {
    throw new Error(`Fixture script is missing: ${FIXTURE_SCRIPT}`);
  }
  const child = spawn(
    process.execPath,
    [FIXTURE_SCRIPT, "--port", String(PORT)],
    {
      cwd: ANDROID_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let ready = false;
  const readyPromise = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectReady(
        new Error(
          `Fixture did not become ready within ${READY_TIMEOUT_MS} ms.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, READY_TIMEOUT_MS);
    const settle = (error) => {
      clearTimeout(timer);
      if (error) rejectReady(error);
      else resolveReady();
    };
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (process.env.NATIVE_FIXTURE_VERBOSE) process.stdout.write(text);
      // Wait for the state line too, not just "ready": the fixture prints its
      // startup banner in several chunks and the smoke test needs the path.
      if (
        !ready &&
        stdout.includes("[native-core-fixture] ready") &&
        /state: (.+?) \(removed on stop\)/.test(stdout)
      ) {
        ready = true;
        settle();
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (process.env.NATIVE_FIXTURE_VERBOSE) process.stderr.write(text);
    });
    child.on("error", (error) => settle(error));
    child.on("exit", (code, signal) => {
      if (!ready) {
        settle(
          new Error(
            `Fixture exited before ready (code=${code}, signal=${signal}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          ),
        );
      }
    });
  });
  try {
    await readyPromise;
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGKILL");
    throw error;
  }
  const stateMatch = stdout.match(/state: (.+?) \(removed on stop\)/);
  if (!stateMatch) {
    child.kill("SIGKILL");
    throw new Error(`Fixture did not report its state directory.\n${stdout}`);
  }
  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    runRoot: resolve(ANDROID_ROOT, stateMatch[1]),
  };
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return new Promise((done) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      done(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      done(true);
    };
    child.once("exit", onExit);
  });
}

async function stopFixture() {
  if (!fixture) return;
  const { child } = fixture;
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    if (!(await waitForExit(child, 8_000))) {
      child.kill("SIGKILL");
      await waitForExit(child, 3_000);
    }
  }
  // Safety net for an abnormal child exit; the fixture normally removes this.
  if (fixture.runRoot) {
    await rm(fixture.runRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function post(path, body, headers = {}) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${json.error ?? text}`,
    );
  }
  return json;
}

async function rpc(method, fields = {}) {
  const id = randomUUID();
  const payload = await post(
    "/api/rpc",
    { id, method, ...fields },
    { "X-Forge-Client": clientId },
  );
  assert.equal(payload.id, id, `RPC ${method} response id`);
  assert.equal(payload.method, method, `RPC ${method} response method`);
  if (!payload.ok) {
    const error = new Error(
      `RPC ${method} failed: ${payload.error?.code}: ${payload.error?.message}`,
    );
    error.code = payload.error?.code;
    error.info = payload.error;
    throw error;
  }
  return payload.result;
}

async function rpcError(method, fields = {}) {
  try {
    await rpc(method, fields);
  } catch (error) {
    return error;
  }
  assert.fail(`RPC ${method} unexpectedly succeeded`);
}

function connectEvents(cursor) {
  return new Promise((resolveConnection, rejectConnection) => {
    const socket = new WebSocket(
      `${WS_ORIGIN}/api/events?clientId=${encodeURIComponent(
        clientId,
      )}&cursor=${cursor}`,
      { origin: ORIGIN },
    );
    const recorded = [];
    const waiters = new Set();
    let opened = false;

    const failWaiters = (error) => {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      waiters.clear();
    };

    const checkWaiters = () => {
      for (const waiter of [...waiters]) {
        const found = recorded
          .slice(waiter.from)
          .find((entry) => waiter.predicate(entry));
        if (!found) continue;
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(found);
      }
    };

    socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (Array.isArray(message.events)) {
        recorded.push(...message.events);
        checkWaiters();
      }
      if (typeof message.cursor === "number") {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ cursor: message.cursor }));
        }
      }
    });
    socket.on("open", () => {
      opened = true;
      resolveConnection({
        socket,
        events: recorded,
        waitFor(predicate, { from = 0, timeoutMs = RUN_TIMEOUT_MS } = {}) {
          const existing = recorded.slice(from).find(predicate);
          if (existing) return Promise.resolve(existing);
          return new Promise((resolveWait, rejectWait) => {
            const waiter = {
              from,
              predicate,
              resolve: resolveWait,
              reject: rejectWait,
              timer: setTimeout(() => {
                waiters.delete(waiter);
                rejectWait(
                  new Error(
                    `Timed out waiting for WebSocket event after index ${from}; saw ${recorded.length} events.`,
                  ),
                );
              }, timeoutMs),
            };
            waiters.add(waiter);
            checkWaiters();
          });
        },
        close() {
          failWaiters(new Error("WebSocket closed."));
          socket.close();
        },
      });
    });
    socket.on("error", (error) => {
      if (!opened) rejectConnection(error);
      failWaiters(error);
    });
    socket.on("close", () => {
      if (!opened) {
        rejectConnection(new Error("WebSocket closed before opening."));
      }
      failWaiters(new Error("WebSocket closed."));
    });
  });
}

function eventsForRun(runId, from = 0) {
  return events.events
    .slice(from)
    .filter((entry) => entry.runId === runId)
    .map((entry) => entry.event);
}

async function runPrompt(sessionId, prompt, options = {}) {
  const from = events.events.length;
  const handle = await rpc("startRun", {
    input: {
      sessionId,
      prompt,
      ...(options.permission ? { permission: options.permission } : {}),
    },
  });
  const terminal = await events.waitFor(
    (entry) =>
      entry.runId === handle.runId && entry.event.type === "run_finished",
    { from, timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS },
  );
  return {
    runId: handle.runId,
    terminal: terminal.event,
    events: eventsForRun(handle.runId, from),
    snapshot: await rpc("getSession", { sessionId }),
  };
}

function textOf(commandEvents) {
  return commandEvents
    .filter((event) => event.type === "text_delta")
    .map((event) => event.text)
    .join("");
}

async function main() {
  log(`starting fixture on ${ORIGIN}`);
  fixture = await startFixture();
  log(`fixture state: ${fixture.runRoot}`);
  assert.ok(
    fixture.runRoot.includes(join(".gradle", "native-fixture")),
    "fixture state must stay under android/.gradle/native-fixture",
  );
  assert.ok(
    existsSync(join(fixture.runRoot, "workspace", "README.md")),
    "fixture README.md should exist",
  );

  const connection = await post("/api/connect", {});
  assert.equal(typeof connection.clientId, "string");
  assert.equal(typeof connection.workspace, "string");
  assert.equal(typeof connection.cursor, "number");
  assert.equal(connection.restrictWorkspace, true);
  clientId = connection.clientId;
  assert.ok(
    connection.workspace.startsWith(fixture.runRoot),
    "connected workspace must be the isolated fixture workspace",
  );
  events = await connectEvents(connection.cursor);
  log("HTTP handshake and WebSocket lease established");

  const host = parse(
    hostStateSchema,
    await rpc("getHostState"),
    "getHostState",
  );
  assert.equal(typeof host.hostId, "string");
  assert.ok(Array.isArray(host.runs));

  // Settings, public provider sources and per-source model catalogs.
  let settings = parse(
    publicSettingsSchema,
    await rpc("getSettings"),
    "getSettings",
  );
  assert.equal(settings.hasApiKey, false);
  assert.equal(settings.isConfigured, true);
  assert.equal(settings.providerSources?.length, 2);
  assert.equal(settings.routeGroups?.length, 1);
  assert.equal(settings.reasoningEffort, "medium");
  assert.equal(settings.contextBudgetTokens, 32768);
  const localModels = await rpc("listModels", { sourceId: "fixture-local" });
  assert.deepEqual(localModels, ["fixture-offline"]);
  const cloudModels = await rpc("listModels", { sourceId: "fixture-cloud" });
  assert.deepEqual(cloudModels, [
    "fixture-cloud-model",
    "fixture-cloud-mini",
  ]);
  const unknownSource = await rpcError("listModels", {
    sourceId: "fixture-missing",
  });
  assert.equal(unknownSource.code, "not_found");

  settings = parse(
    publicSettingsSchema,
    await rpc("updateSettings", {
      input: {
        settings: {
          theme: "dark",
          reasoningEffort: "high",
          contextBudgetTokens: 65536,
          modelContextWindows: { "fixture-offline": 32768 },
        },
      },
    }),
    "updateSettings settings",
  );
  assert.equal(settings.theme, "dark");
  assert.equal(settings.reasoningEffort, "high");
  assert.equal(settings.contextBudgetTokens, 65536);
  settings = parse(
    publicSettingsSchema,
    await rpc("getSettings"),
    "getSettings after update",
  );
  assert.equal(settings.contextBudgetTokens, 65536);

  const fakeApiKey = "sk-fixture-not-a-real-key";
  let sourceSettings = parse(
    publicSettingsSchema,
    await rpc("updateSettings", {
      input: {
        source: {
          type: "save",
          source: {
            id: "fixture-smoke-source",
            label: "Fixture Smoke Source",
            baseUrl: "https://fixture.invalid/v1",
            model: "fixture-smoke-model",
            apiMode: "responses",
          },
        },
        apiKey: fakeApiKey,
      },
    }),
    "updateSettings save source",
  );
  let smokeSource = sourceSettings.providerSources.find(
    (source) => source.id === "fixture-smoke-source",
  );
  assert.ok(smokeSource, "saved source should be public");
  assert.equal(smokeSource.revision, 1);
  assert.equal(smokeSource.hasApiKey, false);
  assert.ok(
    !JSON.stringify(sourceSettings).includes(fakeApiKey),
    "fixture must not store or echo the API key",
  );
  assert.deepEqual(
    await rpc("listModels", { sourceId: "fixture-smoke-source" }),
    ["fixture-smoke-model"],
  );

  const stale = await rpcError("updateSettings", {
    input: {
      source: {
        type: "save",
        expectedRevision: 0,
        source: {
          id: "fixture-smoke-source",
          label: "Stale Save",
          baseUrl: "https://fixture.invalid/v1",
          model: "fixture-smoke-model",
        },
      },
    },
  });
  assert.equal(stale.code, "invalid_input");
  sourceSettings = parse(
    publicSettingsSchema,
    await rpc("updateSettings", {
      input: {
        source: {
          type: "save",
          expectedRevision: 1,
          source: {
            id: "fixture-smoke-source",
            label: "Fixture Smoke Source v2",
            baseUrl: "https://fixture.invalid/v1",
            model: "fixture-smoke-model-v2",
            apiMode: "responses",
          },
        },
      },
    }),
    "updateSettings revisioned source",
  );
  smokeSource = sourceSettings.providerSources.find(
    (source) => source.id === "fixture-smoke-source",
  );
  assert.equal(smokeSource.revision, 2);
  assert.equal(smokeSource.model, "fixture-smoke-model-v2");

  sourceSettings = parse(
    publicSettingsSchema,
    await rpc("updateSettings", {
      input: { source: { type: "activate", id: "fixture-smoke-source" } },
    }),
    "updateSettings activate source",
  );
  assert.equal(sourceSettings.activeSourceId, "fixture-smoke-source");
  assert.equal(sourceSettings.model, "fixture-smoke-model-v2");
  assert.deepEqual(await rpc("listModels"), ["fixture-smoke-model-v2"]);

  sourceSettings = parse(
    publicSettingsSchema,
    await rpc("updateSettings", {
      input: { source: { type: "remove", id: "fixture-smoke-source" } },
    }),
    "updateSettings remove source",
  );
  assert.equal(
    sourceSettings.providerSources.some(
      (source) => source.id === "fixture-smoke-source",
    ),
    false,
  );
  assert.equal(sourceSettings.activeSourceId, "fixture-local");
  assert.deepEqual(await rpc("listModels"), ["fixture-offline"]);
  const missingSource = await rpcError("updateSettings", {
    input: { source: { type: "remove", id: "fixture-smoke-source" } },
  });
  assert.equal(missingSource.code, "not_found");
  log("settings persistence and provider-source save/activate/remove verified");

  // Sessions: empty default metadata, then rename/archive/fork with messages.
  const defaultInput = {
    workspace: connection.workspace,
    title: "Default fixture session",
  };
  let session = parse(
    sessionSnapshotSchema,
    await rpc("createSession", { input: defaultInput }),
    "createSession",
  );
  const sessionId = session.id;
  assert.equal(session.status, "idle");
  assert.deepEqual(session.messages, []);
  assert.deepEqual(session.changes, []);
  assert.deepEqual(session.plans, []);
  assert.equal(session.providerSourceId, "fixture-local");

  session = parse(
    sessionSnapshotSchema,
    await rpc("renameSession", {
      sessionId,
      title: "Renamed fixture session",
    }),
    "renameSession",
  );
  assert.equal(session.title, "Renamed fixture session");
  assert.equal(session.titleSource, "user");

  session = parse(
    sessionSnapshotSchema,
    await rpc("archiveSession", { sessionId, archived: true }),
    "archiveSession true",
  );
  assert.equal(session.archived, true);
  session = parse(
    sessionSnapshotSchema,
    await rpc("archiveSession", { sessionId, archived: false }),
    "archiveSession false",
  );
  assert.equal(session.archived, false);

  const hello = await runPrompt(sessionId, "hello");
  assert.equal(hello.terminal.status, "completed");
  assert.match(textOf(hello.events), /Hello from the offline Forge Core fixture\./);
  assert.equal(hello.snapshot.messages.length, 2);
  assert.equal(hello.snapshot.messages[0].content, "hello");
  assert.equal(hello.snapshot.messages[1].role, "assistant");

  const fork = parse(
    sessionSnapshotSchema,
    await rpc("forkSession", { sessionId }),
    "forkSession",
  );
  assert.notEqual(fork.id, sessionId);
  assert.equal(fork.title, "Fork: Renamed fixture session");
  assert.equal(fork.status, "idle");
  assert.equal(fork.forkedFrom, sessionId);
  assert.equal(fork.messages.length, 2);
  assert.equal(fork.messages[0].content, "hello");
  assert.deepEqual(fork.events, []);
  assert.deepEqual(fork.changes, []);
  log("session create/rename/archive/fork and hello streaming verified");

  // Real controller fallback reads the isolated workspace files.
  const rootListing = parse(
    workspaceDirectoryListingDtoSchema,
    await rpc("listWorkspaceEntries", { sessionId }),
    "listWorkspaceEntries root",
  );
  const rootNames = rootListing.entries.map((entry) => entry.name);
  assert.ok(rootNames.includes("README.md"));
  assert.ok(rootNames.includes("src"));
  assert.ok(rootNames.includes("docs"));
  const srcListing = parse(
    workspaceDirectoryListingDtoSchema,
    await rpc("listWorkspaceEntries", { sessionId, path: "src" }),
    "listWorkspaceEntries src",
  );
  assert.ok(
    srcListing.entries.some(
      (entry) => entry.name === "example.kt" && entry.kind === "file",
    ),
  );
  const readme = parse(
    workspaceFilePreviewDtoSchema,
    await rpc("readWorkspaceFile", { sessionId, path: "README.md" }),
    "readWorkspaceFile README.md",
  );
  assert.match(readme.content, /Forge native fixture workspace/);
  assert.equal(readme.binary, false);

  // Approval still uses the real controller handshake and isolated write.
  const approvalSession = parse(
    sessionSnapshotSchema,
    await rpc("createSession", {
      input: { workspace: connection.workspace, title: "Approval fixture" },
    }),
    "createSession approval",
  );
  const approvalFrom = events.events.length;
  const approvalRun = await rpc("startRun", {
    input: {
      sessionId: approvalSession.id,
      prompt: "approval",
      permission: "readonly",
    },
  });
  const requested = await events.waitFor(
    (entry) =>
      entry.runId === approvalRun.runId &&
      entry.event.type === "approval_requested",
    { from: approvalFrom },
  );
  const approvalId = requested.event.request.id;
  const activeHost = parse(
    hostStateSchema,
    await rpc("getHostState"),
    "getHostState during approval",
  );
  const active = activeHost.runs.find((run) => run.runId === approvalRun.runId);
  assert.ok(active, "approval run should be active");
  assert.ok(
    active.pendingApprovals.some((item) => item.id === approvalId),
    "pending approval should be exposed",
  );
  await rpc("answerApproval", {
    runId: approvalRun.runId,
    approvalId,
    approved: true,
  });
  const approvalTerminal = await events.waitFor(
    (entry) =>
      entry.runId === approvalRun.runId &&
      entry.event.type === "run_finished",
    { from: approvalFrom },
  );
  assert.equal(approvalTerminal.event.status, "completed");
  const approvalFile = parse(
    workspaceFilePreviewDtoSchema,
    await rpc("readWorkspaceFile", {
      sessionId: approvalSession.id,
      path: "fixture-approval.txt",
    }),
    "approval file",
  );
  assert.match(approvalFile.content, /offline native fixture approval/);
  log("approval_requested -> answerApproval -> isolated file verified");

  // Workbench prompt: structured markdown/code/table plus plan, diff and usage.
  const workbench = await runPrompt(sessionId, "workbench");
  assert.equal(workbench.terminal.status, "completed");
  assert.ok(workbench.terminal.usage?.totalTokens > 0);
  assert.ok(
    workbench.events.some((event) => event.type === "plan_updated"),
    "workbench should emit plan_updated",
  );
  assert.ok(
    workbench.events.some((event) => event.type === "context_usage"),
    "workbench should emit context_usage",
  );
  assert.ok(
    workbench.events.some((event) => event.type === "tool_finished"),
    "workbench should emit a tool result carrying the change",
  );
  const workbenchText = textOf(workbench.events);
  assert.match(workbenchText, /```kotlin/);
  assert.match(workbenchText, /\| step \| status \|/);
  assert.match(workbenchText, /fixture 模拟用量/);

  session = parse(
    sessionSnapshotSchema,
    await rpc("getSession", { sessionId }),
    "getSession after workbench",
  );
  assert.equal(session.messages.length, 4);
  assert.equal(session.plans?.length, 1);
  assert.equal(session.plan?.id, "fixture-workbench-plan");
  assert.equal(session.changes.length, 1);
  assert.equal(session.changes[0].path, "docs/workbench-report.md");
  assert.ok(session.changes[0].patch);
  assert.ok(session.changes[0].patch.hunks.length > 0);
  assert.match(
    session.contextSummary?.content ?? "",
    /Offline fixture context summary/,
  );
  assert.equal(session.contextSummary?.fallback, false);

  const diagnostics = await rpc("getDiagnostics", { sessionId });
  assert.equal(diagnostics.messageCount, 4);
  assert.ok(diagnostics.transcriptChars > 0);
  assert.ok(diagnostics.projectedChars > 0);
  assert.equal(diagnostics.summaryFallback, false);

  const context = parse(
    projectContextDtoSchema,
    await rpc("getProjectContext", { sessionId }),
    "getProjectContext",
  );
  assert.equal(context.counts.instructions, 2);
  assert.equal(context.counts.skills, 1);
  assert.equal(context.workspace, connection.workspace);
  assert.ok(context.instructionSources.length >= 2);
  assert.ok(context.skills.length >= 1);
  assert.ok(context.warnings.length >= 1);

  const usage = parse(
    usageStatsDtoSchema,
    await rpc("getUsageStats"),
    "getUsageStats",
  );
  assert.ok(usage.totalTokens > 0);
  assert.ok(usage.totalRuns > 0);
  assert.ok(usage.totalSessions > 0);
  assert.ok(usage.models.length >= 1);
  assert.ok(usage.daily.length >= 1);
  assert.ok(usage.topSessions.length >= 1);
  assert.equal(usage.pricing?.state, "unavailable");
  assert.ok(usage.averageCacheRate >= 0 && usage.averageCacheRate <= 1);

  const docsListing = parse(
    workspaceDirectoryListingDtoSchema,
    await rpc("listWorkspaceEntries", { sessionId, path: "docs" }),
    "listWorkspaceEntries docs",
  );
  assert.ok(
    docsListing.entries.some((entry) => entry.name === "workbench-report.md"),
  );
  const report = parse(
    workspaceFilePreviewDtoSchema,
    await rpc("readWorkspaceFile", {
      sessionId,
      path: "docs/workbench-report.md",
    }),
    "readWorkspaceFile workbench report",
  );
  assert.match(report.content, /Native fixture workbench report/);

  const emptyCheckpoints = await rpc("listCheckpoints", {
    sessionId: approvalSession.id,
  });
  assert.deepEqual(emptyCheckpoints, []);
  let checkpoints = await rpc("listCheckpoints", { sessionId });
  assert.equal(checkpoints.length, 1);
  const checkpoint = parse(
    checkpointDtoSchema,
    checkpoints[0],
    "listCheckpoints item",
  );
  assert.equal(checkpoint.id, "c0f1e2d3-4a5b-4c6d-8e9f-0123456789ab");
  assert.equal(checkpoint.path, "src/example.kt");
  assert.equal(checkpoint.state, "completed");
  const diff = await rpc("getCheckpointDiff", {
    sessionId,
    checkpointId: checkpoint.id,
  });
  assert.match(diff, /^--- a\/src\/example\.kt/m);
  assert.match(diff, /\+    const val workbench: Boolean = true/);
  const restored = parse(
    sessionSnapshotSchema,
    await rpc("restoreCheckpoint", {
      sessionId,
      checkpointId: checkpoint.id,
    }),
    "restoreCheckpoint",
  );
  assert.equal(restored.id, sessionId);
  checkpoints = await rpc("listCheckpoints", { sessionId });
  assert.equal(checkpoints[0].state, "restored");
  const restoredFile = parse(
    workspaceFilePreviewDtoSchema,
    await rpc("readWorkspaceFile", {
      sessionId,
      path: "src/example.kt",
    }),
    "readWorkspaceFile restored example",
  );
  assert.match(restoredFile.content, /const val workbench: Boolean = true/);
  const workbenchFork = parse(
    sessionSnapshotSchema,
    await rpc("forkSession", { sessionId }),
    "forkSession workbench",
  );
  assert.equal(workbenchFork.messages.length, 4);
  assert.equal(workbenchFork.plans?.length, 1);
  assert.match(
    workbenchFork.contextSummary?.content ?? "",
    /Offline fixture context summary/,
  );
  assert.equal(workbenchFork.status, "idle");
  log("workbench reply/plan/change/usage/context/checkpoint verified");

  // MCP metadata CRUD: DTOs are strict and no process/network is started.
  const initialMcp = await rpc("listMcpServers");
  assert.equal(initialMcp.length, 2);
  for (const record of initialMcp) {
    parse(mcpRecordDtoSchema, record, "listMcpServers record");
  }
  const registeredStdio = parse(
    mcpRecordDtoSchema,
    await rpc("registerMcpServer", {
      input: {
        id: "fixture-smoke",
        label: "Fixture Smoke MCP",
        command: "node",
        args: ["smoke.mjs"],
        enabled: true,
        requestTimeoutMs: 5000,
      },
    }),
    "registerMcpServer stdio",
  );
  assert.equal(registeredStdio.transport, "stdio");
  assert.equal(registeredStdio.command, "node");
  await rpc("setMcpEnabled", { serverId: "fixture-smoke", enabled: false });
  const health = parse(
    mcpHealthDtoSchema,
    await rpc("getMcpHealth", { serverId: "fixture-smoke" }),
    "getMcpHealth",
  );
  assert.equal(health.connected, false);
  assert.match(health.lastError, /metadata-only/);
  const remoteHeader = "Bearer fixture-metadata-only";
  const registeredRemote = parse(
    mcpRecordDtoSchema,
    await rpc("registerMcpServer", {
      input: {
        id: "fixture-remote-smoke",
        label: "Fixture Remote Smoke",
        transport: "http",
        url: "https://fixture.invalid/mcp",
        headers: { Authorization: remoteHeader },
        enabled: false,
      },
    }),
    "registerMcpServer remote",
  );
  assert.equal(registeredRemote.command, "");
  assert.equal(registeredRemote.transport, "http");
  assert.equal(registeredRemote.headerCount, 1);
  assert.equal(registeredRemote.hasPrivateHeaders, true);
  assert.ok(!JSON.stringify(registeredRemote).includes(remoteHeader));
  const duplicateMcp = await rpcError("registerMcpServer", {
    input: {
      id: "fixture-smoke",
      label: "Duplicate",
      command: "node",
      args: [],
    },
  });
  assert.equal(duplicateMcp.code, "invalid_input");
  await rpc("removeMcpServer", { serverId: "fixture-smoke" });
  await rpc("removeMcpServer", { serverId: "fixture-remote-smoke" });
  const finalMcp = await rpc("listMcpServers");
  assert.equal(
    finalMcp.some((record) => record.id === "fixture-smoke"),
    false,
  );
  log("MCP strict DTO list/enable/health/register/remove verified");

  // Durable input queue: pause/cancel, explicit resume after a cancelled run,
  // and idempotent enqueue that never replays a consumed input.
  const queueSession = parse(
    sessionSnapshotSchema,
    await rpc("createSession", {
      input: { workspace: connection.workspace, title: "Queue fixture" },
    }),
    "createSession queue",
  );
  let queue = parse(
    inputQueueSnapshotSchema,
    await rpc("pauseInputs", { sessionId: queueSession.id }),
    "pauseInputs",
  );
  assert.equal(queue.paused, true);
  const pausedInputId = randomUUID();
  const pausedInput = {
    inputId: pausedInputId,
    input: { sessionId: queueSession.id, prompt: "queued while paused" },
  };
  const queuedWhilePaused = parse(
    queuedInputSchema,
    await rpc("enqueueInput", { input: pausedInput }),
    "enqueueInput while paused",
  );
  assert.equal(queuedWhilePaused.state, "queued");
  assert.equal(queuedWhilePaused.sequence, 1);
  const duplicatePaused = parse(
    queuedInputSchema,
    await rpc("enqueueInput", { input: pausedInput }),
    "duplicate enqueueInput",
  );
  assert.equal(duplicatePaused.sequence, queuedWhilePaused.sequence);
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("listInputs", { sessionId: queueSession.id }),
    "listInputs paused",
  );
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].state, "queued");
  assert.equal(
    await rpc("cancelInput", {
      sessionId: queueSession.id,
      inputId: pausedInputId,
    }),
    true,
  );
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("listInputs", { sessionId: queueSession.id }),
    "listInputs cancelled",
  );
  assert.equal(queue.items[0].state, "cancelled");
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("resumeInputs", { sessionId: queueSession.id }),
    "resumeInputs empty",
  );
  assert.equal(queue.paused, false);

  const slowFrom = events.events.length;
  const slow = await rpc("startRun", {
    input: { sessionId: queueSession.id, prompt: "slow" },
  });
  await events.waitFor(
    (entry) =>
      entry.runId === slow.runId && entry.event.type === "text_delta",
    { from: slowFrom },
  );
  const queuedAfterStopId = randomUUID();
  const queuedAfterStopInput = {
    inputId: queuedAfterStopId,
    input: { sessionId: queueSession.id, prompt: "queued after stop" },
  };
  const queuedAfterStop = parse(
    queuedInputSchema,
    await rpc("enqueueInput", { input: queuedAfterStopInput }),
    "enqueueInput after slow",
  );
  assert.equal(queuedAfterStop.state, "queued");
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("listInputs", { sessionId: queueSession.id }),
    "listInputs while slow",
  );
  assert.equal(queue.paused, false);
  assert.equal(
    queue.items.find((item) => item.inputId === queuedAfterStopId)?.state,
    "queued",
  );
  const cancelFrom = events.events.length;
  await rpc("cancelRun", { runId: slow.runId, wait: true });
  const slowTerminal = await events.waitFor(
    (entry) =>
      entry.runId === slow.runId && entry.event.type === "run_finished",
    { from: slowFrom },
  );
  assert.equal(slowTerminal.event.status, "cancelled");
  await sleep(300);
  assert.equal(
    events.events
      .slice(cancelFrom)
      .filter(
        (entry) =>
          entry.event.sessionId === queueSession.id &&
          entry.event.type === "run_started",
      ).length,
    0,
    "a cancelled predecessor must not auto-start queued input",
  );
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("listInputs", { sessionId: queueSession.id }),
    "listInputs after cancel",
  );
  assert.equal(queue.paused, true);
  assert.match(queue.reason ?? "", /cancelled/);
  assert.equal(
    queue.items.find((item) => item.inputId === queuedAfterStopId)?.state,
    "queued",
  );

  const resumeFrom = events.events.length;
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("resumeInputs", { sessionId: queueSession.id }),
    "resumeInputs after cancel",
  );
  assert.equal(queue.paused, false);
  const queuedTerminal = await events.waitFor(
    (entry) =>
      entry.event.sessionId === queueSession.id &&
      entry.event.type === "run_finished",
    { from: resumeFrom, timeoutMs: 30_000 },
  );
  assert.equal(queuedTerminal.event.status, "completed");
  const queueSnapshot = parse(
    sessionSnapshotSchema,
    await rpc("getSession", { sessionId: queueSession.id }),
    "getSession queued run",
  );
  assert.ok(
    queueSnapshot.messages.some(
      (message) =>
        message.role === "user" &&
        message.content === "queued after stop",
    ),
  );
  queue = parse(
    inputQueueSnapshotSchema,
    await rpc("listInputs", { sessionId: queueSession.id }),
    "listInputs consumed",
  );
  const consumed = queue.items.find(
    (item) => item.inputId === queuedAfterStopId,
  );
  assert.equal(consumed.state, "consumed");
  assert.equal(consumed.outcome, "completed");
  assert.equal(consumed.input, null);

  const replayFrom = events.events.length;
  const replay = parse(
    queuedInputSchema,
    await rpc("enqueueInput", { input: queuedAfterStopInput }),
    "duplicate consumed enqueueInput",
  );
  assert.equal(replay.state, "consumed");
  assert.equal(replay.inputId, queuedAfterStopId);
  await sleep(300);
  assert.equal(
    events.events
      .slice(replayFrom)
      .filter(
        (entry) =>
          entry.event.sessionId === queueSession.id &&
          entry.event.type === "run_started",
      ).length,
    0,
    "a consumed input must never be replayed",
  );
  log("durable queue pause/cancel/explicit resume/idempotency verified");

  // Final settings and session snapshots must still be schema-valid.
  parse(publicSettingsSchema, await rpc("getSettings"), "final getSettings");
  parse(
    sessionSnapshotSchema,
    await rpc("getSession", { sessionId }),
    "final getSession",
  );
  assert.ok(fixture.stdout().includes("real Core durable input-queue"));
  log("PASS: native workbench fixture smoke completed");
}

try {
  await main();
} catch (error) {
  console.error(`[native-workbench-smoke] FAIL: ${error.stack ?? error}`);
  if (fixture?.stderr()) {
    console.error(`[native-workbench-smoke] fixture stderr:\n${fixture.stderr()}`);
  }
  if (fixture?.stdout()) {
    console.error(`[native-workbench-smoke] fixture stdout:\n${fixture.stdout()}`);
  }
  process.exitCode = 1;
} finally {
  events?.close();
  await stopFixture();
}
