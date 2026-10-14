#!/usr/bin/env node
/**
 * qa-cli-live.mjs — real-PTY live installed CLI smoke/capture harness.
 *
 * Launches the real installed Forge CLI in a real pseudo-terminal via the
 * existing .build/qa-pty-helper.py (python3 stdlib pty), drives a live
 * scenario against the actual configured provider, and captures raw ANSI
 * bytes, PTY event logs, and real xterm.js screenshots.
 *
 * Scenario: waitstartup → optional /model → /permission readonly →
 * Chinese prompt with COMPOSED unique marker (two nonadjacent quoted pieces)
 * → wait_for expected marker (max 120s) → mark → /quit → exit0.
 *
 * Uses os.homedir() for the real user home; reads config implicitly by
 * launching the CLI.  MUST NOT read/print API key or copy settings.
 * Root will run after install; author only does node --check.
 *
 * QA-owned file: scripts/qa-cli-live.mjs only.
 *
 * Usage:
 *   node scripts/qa-cli-live.mjs --cli <path> [--evidence-dir <dir>]
 *     [--model <id>] [--cols80 | --cols N] [--theme light|dark]
 *
 * Exit code: 0 when no check failed, 1 otherwise.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PTY_HELPER = join(ROOT, ".build", "qa-pty-helper.py");

const TOKEN_A = "FORGE_LIVE_";
const TOKEN_B = "OK_";
const NONCE = randomBytes(4).toString("hex");
const EXPECTED_MARKER = TOKEN_A + TOKEN_B + NONCE;

const DEFAULT_CHROME =
  process.env.QA_CHROME ||
  "/home/ling/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";

const CLI_CHECK_TIMEOUT_MS = 20_000;
const SESSION_POLL_INTERVAL_MS = 2_000;
const SESSION_POLL_TIMEOUT_MS = 120_000;
const TOTAL_SCENARIO_TIMEOUT_MS = 300_000;
const STARTUP_WAIT_MS = 4_000;
const POST_COMMAND_WAIT_MS = 2_000;
const MARKER_WAIT_TIMEOUT_MS = 120_000;
const QUIT_WAIT_MS = 8_000;

// ---------------------------------------------------------------- args ----

function usage() {
  return [
    "qa-cli-live.mjs — real PTY live CLI smoke/capture",
    "  --cli PATH          installed forge binary or cli.mjs [required]",
    "  --evidence-dir DIR  output directory [default: .build/live-qa-<ts>]",
    "  --model ID          exact model ID for /model command [optional]",
    "  --cols80            use 80 columns (legacy shorthand)",
    "  --cols N            column width [default: 80]",
    "  --theme light|dark  terminal theme [default: dark]",
    "  --chrome PATH       chromium binary [default: playwright chromium-1248]",
    "  --xterm-root DIR    dir containing @xterm/xterm + @xterm/addon-fit",
    "",
    "  Scenario: startup → /model → /permission readonly →",
    "    Chinese prompt with composed marker → wait_for marker → /quit",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    cli: null,
    evidenceDir: null,
    model: null,
    cols: 80,
    theme: "dark",
    chrome: DEFAULT_CHROME,
    xtermRoot: process.env.XTERM_ROOT || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--cli":
        args.cli = next();
        break;
      case "--evidence-dir":
        args.evidenceDir = next();
        break;
      case "--model":
        args.model = next();
        break;
      case "--cols80":
        args.cols = 80;
        break;
      case "--cols":
        args.cols = parseInt(next(), 10);
        if (Number.isNaN(args.cols) || args.cols < 40 || args.cols > 400) {
          console.error("--cols must be an integer 40–400");
          process.exit(2);
        }
        break;
      case "--theme": {
        const t = next();
        if (t !== "light" && t !== "dark") {
          console.error("--theme must be 'light' or 'dark'");
          process.exit(2);
        }
        args.theme = t;
        break;
      }
      case "--chrome":
        args.chrome = next();
        break;
      case "--xterm-root":
        args.xtermRoot = next();
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      default:
        console.error(`unknown argument: ${arg}\n\n${usage()}`);
        process.exit(2);
    }
  }
  if (!args.cli) {
    console.error(`--cli PATH is required\n\n${usage()}`);
    process.exit(2);
  }
  args.cli = resolve(args.cli);
  return args;
}

// -------------------------------------------------------- xterm assets ----

async function resolveXterm(explicit) {
  const unicodeCandidates = [explicit, join(ROOT, ".build/qa-deps")].filter(Boolean)
    .map((base) => join(base, "@xterm/addon-unicode11/lib/addon-unicode11.mjs"));
  const unicodeAsset = unicodeCandidates.find((path) => existsSync(path));
  if (!unicodeAsset) throw new Error(
    "Missing official QA @xterm/addon-unicode11@0.9.0 ESM asset. Place it in " +
    ".build/qa-deps/@xterm/addon-unicode11/lib/addon-unicode11.mjs or provide --xterm-root. No network fallback.",
  );
  const candidates = [
    explicit,
    join(ROOT, ".build/qa-deps"),
    "/home/ling/.local/share/pi-node/node-v22.23.1-linux-x64/lib/node_modules/@jmfederico/pi-web/node_modules",
    "/usr/local/lib/node_modules",
    "/usr/lib/node_modules",
  ].filter(Boolean);
  for (const base of candidates) {
    const xtermDir = join(base, "@xterm", "xterm");
    const fitDir = join(base, "@xterm", "addon-fit");
    if (
      existsSync(join(xtermDir, "lib", "xterm.mjs")) &&
      existsSync(join(fitDir, "lib", "addon-fit.mjs"))
    ) {
      return { source: base, xtermDir, fitDir, unicodeAsset };
    }
  }
  // No npm pack / network fallback — resources already available or fail.
  throw new Error(
    `xterm assets not found. Tried:\n${candidates.map((c) => `  ${join(c, "@xterm", "xterm")}`).join("\n")}\n` +
    `Provide --xterm-root or place @xterm/xterm + @xterm/addon-fit in .build/qa-deps`,
  );
}

// ---------------------------------------------------- xterm render page --
//
// Theme background/foreground are injected at init time by the test harness.
// The RENDER_HTML template is validated via VM preflight before any live run.

const RENDER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/assets/xterm/xterm.css">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #host { display: inline-block; padding: 12px; }
  .xterm { text-spacing-trim: space-all; }
</style>
</head>
<body>
<div id="host"></div>
<script type="module">
import { Terminal } from "/assets/xterm/xterm.mjs";
import { FitAddon } from "/assets/xterm/addon-fit.mjs";
import { Unicode11Addon } from "/assets/xterm/addon-unicode11.mjs";
function activateUnicode11(terminal) {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  if (terminal.unicode.activeVersion !== '11') throw new Error('Unicode11 activation failed');
}
let term = null;
window.__qa = {
  async unicodeProbe() {
    const probe = new Terminal({ cols: 32, rows: 2, allowProposedApi: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      activateUnicode11(probe);
      probe.open(host);
      await new Promise((done) => probe.write('中文🎉é A B', done));
      const buf = probe.buffer.active;
      const line = buf.getLine(0);
      // Fixed fixture assertions against actual xterm cells, not a width oracle.
      const expected = [[0, '中', 2], [1, '', 0], [2, '文', 2], [3, '', 0],
        [4, '🎉', 2], [5, '', 0], [6, 'é', 1], [7, ' ', 1],
        [8, 'A', 1], [9, ' ', 1], [10, 'B', 1]];
      for (const [x, chars, width] of expected) {
        const cell = line.getCell(x);
        if (cell.getChars() !== chars || cell.getWidth() !== width)
          throw new Error('Unicode11 sanity probe cell mismatch at ' + x);
      }
      if (buf.cursorX !== 11 || buf.cursorY !== 0 ||
          line.translateToString(true) !== '中文🎉é A B' || line.getCell(11).getChars() !== '')
        throw new Error('Unicode11 sanity probe cursor/space mismatch');
      return { activeUnicodeVersion: probe.unicode.activeVersion, passed: true,
        widths: { chinese: [2, 2], emoji: 2, combining: 1 }, cursor: { x: 11, y: 0 } };
    } finally {
      probe.dispose();
      host.remove();
    }
  },
  init(cols, rows, theme) {
    if (term) term.dispose();
    term = new Terminal({
      cols, rows,
      fontSize: 15,
      fontFamily: "monospace",
      cursorBlink: false,
      convertEol: false,
      scrollback: 4000,
      theme: theme || { background: "#101014", foreground: "#e8e8ec", cursor: "#e8e8ec" },
      allowProposedApi: true,
    });
    activateUnicode11(term);
    term.open(document.getElementById("host"));
    const box = document.getElementById("host").getBoundingClientRect();
    return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
  },
  async feed(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    await new Promise((done) => term.write(bytes, done));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  },
  state() {
    const buf = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buf.length; i += 1)
      lines.push(buf.getLine(i) ? buf.getLine(i).translateToString(true) : "");
    const viewport = [];
    for (let y = 0; y < term.rows; y += 1) {
      const line = buf.getLine(buf.viewportY + y);
      viewport.push(line ? line.translateToString(false) : "");
    }
    return {
      text: lines.join("\\n"),
      viewport: viewport.join("\\n"),
      activeUnicodeVersion: term.unicode.activeVersion,
      textSpacingTrim: getComputedStyle(term.element).textSpacingTrim,
      cols: term.cols,
      rows: term.rows,
      cursor: { x: buf.cursorX, y: buf.cursorY },
    };
  },
};
window.__qaReady = true;
</script>
</body>
</html>`;

// --------------------------------------------------------- helpers ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function parseEvents(eventsText) {
  return eventsText
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function check(condition, okMsg, failMsg) {
  if (condition) {
    console.log(`  ok    ${okMsg}`);
    return true;
  }
  console.log(`  FAIL  ${failMsg || okMsg}`);
  return false;
}

// -------------------------------------------- session snapshot helpers ----
// Snapshot existing session IDs BEFORE launch so we can detect only NEW
// sessions created by THIS test run.  readLatestSession was unsafe because
// it picked by mtime and could match a preexisting session.

/**
 * Snapshot session IDs that exist before the CLI is launched.
 * Returns a Set of session filenames (basename) already present.
 */
async function snapshotExistingSessions(forgeHome) {
  const sessionsDir = join(forgeHome, "sessions");
  const existing = new Set();
  try {
    const entries = await readdir(sessionsDir);
    for (const f of entries) {
      if (f.endsWith(".json") && !f.includes(".lock")) {
        existing.add(f);
      }
    }
  } catch {
    // sessions dir may not exist yet; that's fine
  }
  return existing;
}

/**
 * Poll for a NEW session file (not in preExisting set) that is completed.
 * Requires: new file appears, status === "completed", last assistant content
 * trimmed equals expectedMarker, and model matches if provided.
 *
 * Returns { data, path, sessionId } or null on timeout.
 * Throws on explicit failure (new file but validation fails).
 */
async function pollNewSession({
  forgeHome,
  preExisting,
  expectedMarker,
  expectedModel,
  expectedPrompt,
}) {
  const sessionsDir = join(forgeHome, "sessions");
  const deadline = Date.now() + SESSION_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let entries;
    try {
      entries = await readdir(sessionsDir);
    } catch {
      await sleep(SESSION_POLL_INTERVAL_MS);
      continue;
    }
    const newFiles = entries.filter(
      (f) => f.endsWith(".json") && !f.includes(".lock") && !preExisting.has(f),
    );
    for (const filename of newFiles) {
      const filePath = join(sessionsDir, filename);
      let raw;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const messages = data.messages || data.transcript || [];
      if (!expectedPrompt || !Array.isArray(messages) || !messages.some(
        (m) => m.role === "user" && m.content === expectedPrompt,
      )) continue;
      const status = data.status || "";
      if (status !== "completed") continue;

      // Found a new completed session.  Validate it.
      const sessionId = data.id || data.sessionId || filename.replace(".json", "");
      const sessionModel = data.model || "";
      const assistantMessages = messages.filter(
        (m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim(),
      );
      const lastAssistant =
        assistantMessages.length > 0
          ? assistantMessages[assistantMessages.length - 1].content.trim()
          : "";
      const actualMatches = lastAssistant === expectedMarker;
      const modelOk = !expectedModel || sessionModel === expectedModel;

      return {
        data,
        path: filePath,
        sessionId,
        status,
        model: sessionModel,
        lastAssistant,
        expectedMarker,
        actualMatches,
        modelOk,
      };
    }
    await sleep(SESSION_POLL_INTERVAL_MS);
  }
  return null;
}

// ------------------------------------------------ xterm assets helper ----

async function feedTo(page, raw, from, to) {
  const slice = raw.subarray(from, to);
  const CHUNK = 24 * 1024;
  for (let i = 0; i < slice.length; i += CHUNK) {
    const chunk = slice.subarray(i, i + CHUNK);
    await page.evaluate((data) => window.__qa.feed(data), b64(chunk));
  }
}

// ---------------------------------------------- release hash helper ----
//
// Hash the ACTUAL --cli file.  For launchers (~/.local/bin/forge),
// record the launcher hash AND resolve readlink to the real payload.

async function recordReleaseInfo(evidenceDir, cliPath) {
  const { realpath } = await import("node:fs/promises");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const cliContent = await readFile(cliPath);
  const info = { cliPath, launcherHash: hash(cliContent), payloadHash: null,
    resolvedPath: null, releasePath: null, installedMetadata: null, version: null };
  let payloadPath = cliPath;
  if (!cliPath.endsWith(".mjs")) {
    const target = join(homedir(), ".local/share/forge-harness/current/cli/cli.mjs");
    // Accept only the known regular wrapper; never execute/source shell text.
    const wrapper = `#!/bin/sh\nexec node '${target}' "$@"`;
    if (cliPath !== join(homedir(), ".local/bin/forge") ||
        cliContent.toString("utf8").trim() !== wrapper) {
      throw new Error("Unsupported CLI launcher: payload provenance unavailable");
    }
    payloadPath = target;
    info.releasePath = await realpath(join(homedir(), ".local/share/forge-harness/current"));
    const metadataPath = join(info.releasePath, "release.json");
    const metadataBytes = await readFile(metadataPath);
    const metadata = JSON.parse(metadataBytes.toString("utf8"));
    if (typeof metadata.version !== "string" || typeof metadata.buildId !== "string") {
      throw new Error("Installed release metadata is incomplete");
    }
    info.installedMetadata = { path: metadataPath, sha256: hash(metadataBytes),
      version: metadata.version, buildId: metadata.buildId, builtAt: metadata.builtAt };
    info.version = metadata.version;
  }
  info.resolvedPath = await realpath(payloadPath);
  if (info.releasePath && info.resolvedPath !== join(info.releasePath, "cli/cli.mjs")) {
    throw new Error("Installed current release changed during provenance collection");
  }
  info.payloadHash = hash(await readFile(info.resolvedPath));

  await writeFile(join(evidenceDir, "release-info.json"), JSON.stringify(info, null, 2));
  return info;
}

// --------------------------------------------- VM preflight for HTML ----
// Validate RENDER_HTML inline JS syntax before any live run.
// Uses vm.compileFunction with stubbed browser globals.
// The inline script uses ESM imports (valid in browser module context),
// so we strip import/export statements before validating the body.

async function preflightRenderHtml(html) {
  // Dynamic import (not require) for ESM compatibility.
  const { compileFunction } = await import("node:vm");
  const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("RENDER_HTML: no <script type=\"module\"> found");
  let jsSource = scriptMatch[1];

  // Strip ESM import/export lines — valid in browser module context but
  // vm.compileFunction treats the body as CommonJS.
  jsSource = jsSource.replace(/^\s*(import|export)\s+.*$/gm, "");

  try {
    compileFunction(jsSource, ["document", "requestAnimationFrame", "atob", "window", "Uint8Array"], {});
    console.log("[live] VM preflight: RENDER_HTML inline JS syntax OK");
  } catch (e) {
    throw new Error(`RENDER_HTML inline JS syntax error: ${e.message}`);
  }
}

// --------------------------------------------------------- scenario ----

function createChecker() {
  const failures = [];
  return {
    failures,
    ok: () => failures.length === 0,
    check(condition, okMsg, failMsg) {
      if (condition) {
        console.log(`  ok    ${okMsg}`);
        return true;
      }
      const msg = failMsg || okMsg;
      console.log(`  FAIL  ${msg}`);
      failures.push(msg);
      return false;
    },
  };
}

async function runLiveScenario({
  args, evidenceDir, page, serverPort, preExistingSessions,
}) {
  const cols = args.cols;
  const rows = 30;
  const ck = createChecker();
  const { check } = ck;

  const rawPath = join(evidenceDir, "live.raw");
  const eventsPath = join(evidenceDir, "live.events.jsonl");
  const scenarioPath = join(evidenceDir, "live.scenario.json");

  // --- Build the PTY scenario steps ---
  const steps = [];

  // 1. Wait for startup
  steps.push({ action: "wait", ms: STARTUP_WAIT_MS });
  steps.push({ action: "mark", name: "startup" });

  // 2. Set model if --model supplied
  if (args.model) {
    steps.push({ action: "type", text: `/model ${args.model}` });
    steps.push({ action: "key", name: "enter" });
    steps.push({ action: "wait", ms: POST_COMMAND_WAIT_MS });
    steps.push({ action: "mark", name: "model-set" });
  }

  // 3. Set permission readonly
  steps.push({ action: "type", text: "/permission readonly" });
  steps.push({ action: "key", name: "enter" });
  steps.push({ action: "wait", ms: POST_COMMAND_WAIT_MS });
  steps.push({ action: "mark", name: "permission-set" });

  // 4. Clear any existing draft
  steps.push({ action: "key", name: "ctrl-u" });
  steps.push({ action: "wait", ms: 200 });

  // 5. Chinese prompt with COMPOSED marker.
  //    Two nonadjacent quoted pieces: TOKEN_A is in quotes at the start,
  //    TOKEN_B+NONCE is in quotes at the end.  The expected full marker
  //    (TOKEN_A + TOKEN_B + NONCE) appears NOWHERE in the prompt text —
  //    it can only appear in the assistant's reply.
  const prompt =
    `请回复下面两个引号内的内容拼接在一起，不要有空格或其他文字，也不要使用任何工具：` +
    `"${TOKEN_A}" 和 "${TOKEN_B}${NONCE}"。只需回复拼接结果。`;
  steps.push({ action: "type", text: prompt });
  // Mark BEFORE Enter: the helper drains response bytes during submission.
  steps.push({ action: "mark", name: "prompt-sent" });
  steps.push({ action: "key", name: "enter" });

  // 7. Wait for expected marker to appear in the PTY stream.
  //    Scoped after "prompt-sent" mark so a stale earlier occurrence
  //    cannot false-pass.  Uses wait_for with regex (escaped).
  const markerRegex = EXPECTED_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  steps.push({
    action: "wait_for",
    name: "expected-marker",
    pattern: markerRegex,
    after_mark: "prompt-sent",
    timeout_ms: MARKER_WAIT_TIMEOUT_MS,
  });

  // Marker text can arrive in an unfinished assistant tail while the runtime
  // is still busy. /quit is ignored until run_finished commits the static
  // status line. Search from prompt-sent so a same-chunk marker+completion
  // already drained by the marker wait still matches. Not a quiet/sleep wait.
  steps.push({
    action: "wait_for",
    name: "run-finished",
    pattern: "completed · 0 tools",
    after_mark: "prompt-sent",
    timeout_ms: MARKER_WAIT_TIMEOUT_MS,
  });

  // 8. Mark only after committed completion, then /quit.
  steps.push({ action: "mark", name: "response-received" });

  // 9. Exit via /quit
  steps.push({ action: "type", text: "/quit" });
  steps.push({ action: "key", name: "enter" });
  steps.push({ action: "wait_exit", timeout_ms: QUIT_WAIT_MS });
  steps.push({ action: "mark", name: "final" });

  // --- Determine CLI command ---
  // Fixed zsh -lic command with positional arguments passed via argv.
  // The .mjs gets process.execPath (node); launcher is executed as path.
  // cwd = real user home, --workspace = real user home.
  const realHome = homedir();
  const forgeHome = join(realHome, ".local", "share", "forge");
  const cliPath = args.cli;

  let cmd;
  if (cliPath.endsWith(".mjs")) {
    cmd = ["/bin/zsh", "-lic", 'exec "$1" "$2" chat --workspace "$3"', "ignored-arg0", process.execPath, cliPath, realHome];
  } else {
    cmd = ["/bin/zsh", "-lic", 'exec "$1" chat --workspace "$2"', "ignored-arg0", cliPath, realHome];
  }

  // --- Build minimal child environment ---
  const isLight = args.theme === "light";
  const env = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: realHome,
    LANG: "C.UTF-8",
    TERM: "xterm-256color",
    COLORFGBG: isLight ? "0;15" : "15;0",
  };

  const scenarioJson = { cmd, env, cwd: realHome, steps };
  await writeFile(scenarioPath, JSON.stringify(scenarioJson, null, 2));

  console.log(`[live] nonce=${NONCE} marker=${EXPECTED_MARKER}`);
  console.log(`[live] forgeHome=${forgeHome}`);
  console.log(`[live] cli=${cliPath}`);
  console.log(`[live] cols=${cols} rows=${rows}`);
  console.log(`[live] theme=${args.theme} COLORFGBG=${env.COLORFGBG}`);
  if (args.model) console.log(`[live] model=${args.model}`);
  console.log(`[live] launching PTY via ${PTY_HELPER}`);

  // --- Launch PTY helper ---
  const helper = spawn(
    "python3",
    [
      PTY_HELPER,
      "--cols", String(cols),
      "--rows", String(rows),
      "--raw", rawPath,
      "--events", eventsPath,
      "--scenario", scenarioPath,
      "--timeout-ms", String(TOTAL_SCENARIO_TIMEOUT_MS),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let helperStdout = "";
  let helperStderr = "";
  helper.stdout.on("data", (d) => { helperStdout += d.toString(); });
  helper.stderr.on("data", (d) => { helperStderr += d.toString(); });
  const helperCode = await new Promise((r, reject) => {
    helper.once("error", reject);
    helper.once("close", r);
  });
  console.log(`[live] PTY helper exit code: ${helperCode}`);

  // --- Read captured data ---
  const raw = await readFile(rawPath).catch(() => Buffer.alloc(0));
  const eventsText = await readFile(eventsPath, "utf8");
  const events = parseEvents(eventsText);
  const exitEvent = [...events].reverse().find((e) => e.type === "exit") || {
    done: false,
    code: null,
    signal: null,
  };

  console.log(`[live] raw bytes: ${raw.length}, events: ${events.length}`);
  console.log(`[live] child exit: done=${exitEvent.done} code=${exitEvent.code} signal=${exitEvent.signal}`);

  // --- Render xterm.js screenshots ---
  const marks = events.filter((e) => e.type === "mark");
  const screenshots = [];
  for (const ev of marks) {
    const offset = ev.offset ?? raw.length;
    await page.goto(`http://127.0.0.1:${serverPort}/render`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__qaReady === true);
    const xtermTheme = isLight
      ? { background: "#ffffff", foreground: "#1a1a1a", cursor: "#1a1a1a" }
      : { background: "#101014", foreground: "#e8e8ec", cursor: "#e8e8ec" };
    await page.evaluate(([c, r, t]) => window.__qa.init(c, r, t), [cols, rows, xtermTheme]);
    await feedTo(page, raw, 0, offset);
    const state = await page.evaluate(() => window.__qa.state());
    const name = `live--${ev.name}--${state.cols}x${state.rows}.png`;
    const box = await page.locator("#host").boundingBox();
    await page.setViewportSize({
      width: Math.ceil(box.width) + 24,
      height: Math.ceil(box.height) + 24,
    });
    await page.locator("#host").screenshot({ path: join(evidenceDir, name) });
    screenshots.push({
      mark: ev.name,
      cols: state.cols,
      rows: state.rows,
      file: name,
    });
    console.log(`[live] screenshot: ${name}`);
  }

  // --- Verify PTY integrity ---
  // All required marks must exist.
  const requiredMarks = ["startup", "prompt-sent", "response-received", "final"];
  if (args.model) requiredMarks.push("model-set");
  requiredMarks.push("permission-set");
  const markNames = new Set(marks.map((m) => m.name));
  for (const req of requiredMarks) {
    check(markNames.has(req), `mark present: ${req}`, `mark MISSING: ${req}`);
  }

  const ptyIssues = [];
  if (helperCode !== 0) ptyIssues.push(`helper exit ${helperCode}`);
  if (!exitEvent.done) ptyIssues.push("child did not exit");
  if (exitEvent.signal != null) ptyIssues.push(`child killed by signal ${exitEvent.signal}`);
  if (exitEvent.code !== 0) ptyIssues.push(`child exit code ${exitEvent.code}`);
  for (const e of events) {
    if (["timeout", "killed", "bad_step"].includes(e.type)) {
      ptyIssues.push(`PTY event: ${e.type}`);
    }
    if (e.type === "wait_for" && !e.matched) {
      ptyIssues.push(`wait_for "${e.name}" did not match (pattern=${e.pattern})`);
    }
    if (e.type === "wait_exit" && !e.done) {
      ptyIssues.push("wait_exit did not complete");
    }
  }
  check(ptyIssues.length === 0, "PTY child exited cleanly (code 0)", ptyIssues.join("; "));

  // --- Verify screenshots ---
  for (const shot of screenshots) {
    const bytes = await readFile(join(evidenceDir, shot.file)).catch(() => null);
    const pngOk =
      Buffer.isBuffer(bytes) &&
      bytes.length > 100 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    check(pngOk, `screenshot valid PNG: ${shot.file}`, `screenshot invalid/missing: ${shot.file}`);
  }

  // --- Verify raw PTY has content ---
  check(raw.length > 100, `raw PTY capture has ${raw.length} bytes`);

  // --- Session JSON verification ---
  // Poll for a NEW session file (not in preExistingSessions).
  // Exact check: status === "completed", last assistant content === expectedMarker,
  // model matches if --model was provided.
  console.log(`[live] polling for NEW session JSON in ${forgeHome}/sessions ...`);
  let sessionResult = null;
  try {
    sessionResult = await pollNewSession({
      forgeHome,
      preExisting: preExistingSessions,
      expectedMarker: EXPECTED_MARKER,
      expectedModel: args.model || null,
      expectedPrompt: prompt,
    });
  } catch (e) {
    check(false, "session processing failed (exception content withheld)");
  }

  if (sessionResult) {
    const { sessionId, status, model, lastAssistant, actualMatches, modelOk } = sessionResult;
    console.log(`[live] session: id=${sessionId} status=${status} model=${model}`);
    console.log(`[live] expected marker: ${EXPECTED_MARKER}`);
    console.log(`[live] actual assistant text (trimmed): ${JSON.stringify(lastAssistant.slice(0, 200))}`);
    console.log(`[live] marker exact match: ${actualMatches}`);

    check(status === "completed", `session status is "completed" (got "${status}")`);
    check(actualMatches, "session assistant text === expected marker (exact trimmed match)");
    if (args.model) {
      check(modelOk, `session model matches requested (got "${model}", want "${args.model}")`);
    }
  } else {
    // No new session found — this is a FAIL.
    check(false, "new session found and completed", "no new completed session found within timeout — FAIL");
  }

  // --- Build and return result ---
  return {
    ok: ck.ok(),
    failures: ck.failures,
    nonce: NONCE,
    marker: EXPECTED_MARKER,
    cols,
    rows,
    cli: args.cli,
    model: args.model,
    theme: args.theme,
    forgeHome,
    exitEvent,
    rawBytes: raw.length,
    eventCount: events.length,
    screenshots,
    session: sessionResult
      ? {
          id: sessionResult.sessionId,
          status: sessionResult.status,
          model: sessionResult.model,
          expectedMarker: sessionResult.expectedMarker,
          actualAssistantText: sessionResult.lastAssistant,
          exactMatch: sessionResult.actualMatches,
        }
      : null,
  };
}

// ------------------------------------------------------------- main ----

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidenceDir = args.evidenceDir
    ? resolve(args.evidenceDir)
    : join(ROOT, ".build", `live-qa-${stamp}`);

  // Evidence dir must NOT already exist (fail if it does).
  if (existsSync(evidenceDir)) {
    console.error(`[live] FATAL: evidence directory already exists: ${evidenceDir}`);
    console.error("[live] Remove it first or use --evidence-dir with a new path.");
    process.exit(2);
  }
  mkdirSync(evidenceDir, { recursive: true });

  console.log(`[live] evidence: ${evidenceDir}`);
  console.log(`[live] invocation: ${process.argv.join(" ")}`);

  // --- Record release info (hash actual --cli file, not repo dist) ---
  const releaseInfo = await recordReleaseInfo(evidenceDir, args.cli);
  console.log(`[live] release: launcherHash=${releaseInfo.launcherHash?.slice(0, 16)}... payloadHash=${releaseInfo.payloadHash?.slice(0, 16)}... version=${releaseInfo.version}`);

  // --- Node --check on installed CLI if it's a .mjs ---
  if (args.cli.endsWith(".mjs")) {
    const syntax = spawnSync(process.execPath, ["--check", args.cli], {
      encoding: "utf8",
      timeout: CLI_CHECK_TIMEOUT_MS,
    });
    if (syntax.status !== 0) {
      console.error(`[live] FATAL: --cli fails node --check: ${args.cli}`);
      if (syntax.stderr) console.error(syntax.stderr.slice(0, 400));
      process.exit(2);
    }
    console.log(`[live] node --check passed: ${args.cli}`);
  }

  // --- VM preflight: validate RENDER_HTML inline JS syntax ---
  try {
    await preflightRenderHtml(RENDER_HTML);
  } catch (e) {
    console.error(`[live] FATAL: ${e.message}`);
    process.exit(2);
  }

  // --- Resolve xterm assets (no network fallback) ---
  const xterm = await resolveXterm(args.xtermRoot);
  console.log(`[live] xterm source: ${xterm.source}`);

  // --- Snapshot existing sessions BEFORE launch ---
  const realHome = homedir();
  const forgeHome = join(realHome, ".local", "share", "forge");
  const preExistingSessions = await snapshotExistingSessions(forgeHome);
  console.log(`[live] pre-existing session files: ${preExistingSessions.size}`);

  // --- Launch browser ---
  const { chromium } = await import("playwright");
  let browser = null;

  // --- Set up HTTP server for xterm.js rendering ---
  const assets = {
    "/assets/xterm/addon-unicode11.mjs": xterm.unicodeAsset,
    "/assets/xterm/xterm.css": join(xterm.xtermDir, "css", "xterm.css"),
    "/assets/xterm/xterm.mjs": join(xterm.xtermDir, "lib", "xterm.mjs"),
    "/assets/xterm/addon-fit.mjs": join(xterm.fitDir, "lib", "addon-fit.mjs"),
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/render") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(RENDER_HTML);
      return;
    }
    if (assets[url.pathname]) {
      readFile(assets[url.pathname]).then(
        (data) => {
          res.writeHead(200, {
            "content-type": url.pathname.endsWith(".css")
              ? "text/css"
              : "text/javascript",
          });
          res.end(data);
        },
        () => res.writeHead(404).end(),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const serverPort = server.address().port;
  console.log(`[live] render server: http://127.0.0.1:${serverPort}`);

  let summary = null;
  let unicodeProbe = null;
  try {
    browser = await chromium.launch({
      executablePath: args.chrome,
      args: ["--no-sandbox", "--force-color-profile=srgb", "--disable-lcd-text"],
    });
    const page = await browser.newPage({ deviceScaleFactor: 2 });

    // Gate real PTY/CLI launch on actual browser cell behavior; probe disposes itself.
    await page.goto(`http://127.0.0.1:${serverPort}/render`);
    await page.waitForFunction(() => window.__qaReady === true);
    unicodeProbe = await page.evaluate(() => window.__qa.unicodeProbe());

    summary = await runLiveScenario({
      args,
      evidenceDir,
      page,
      serverPort,
      preExistingSessions,
    });
  } catch {
    // Do not serialize exception text: it can contain provider/config content.
    summary = { ok: false, failures: ["Capture/render/session processing threw"],
      nonce: NONCE, screenshots: [], session: null };
  } finally {
    // Cleanup: browser, server.  No workspace to remove (using real HOME).
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }

  // --- Write summary ---
  const summaryOut = {
    generatedAt: new Date().toISOString(),
    harness: "scripts/qa-cli-live.mjs + .build/qa-pty-helper.py (real PTY, real API, xterm.js render)",
    invocation: process.argv.join(" "),
    release: releaseInfo,
    activeUnicodeVersion: unicodeProbe?.activeUnicodeVersion ?? null,
    unicodeProbe,
    unicodeAsset: xterm.unicodeAsset,
    nonce: NONCE,
    expectedMarker: EXPECTED_MARKER,
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    result: summary,
  };
  await writeFile(
    join(evidenceDir, "live-summary.json"),
    JSON.stringify(summaryOut, null, 2),
  );

  const pass = summary && summary.ok;
  console.log(`\n${pass ? "PASS" : "FAIL"} — evidence: ${evidenceDir}`);
  if (summary) {
    console.log(
      `  session: ${summary.session?.id || "(none)"} status: ${summary.session?.status || "(unknown)"}`,
    );
    if (summary.session?.expectedMarker) {
      console.log(`  expected: ${summary.session.expectedMarker}`);
      console.log(`  actual:   ${summary.session.actualAssistantText}`);
      console.log(`  exact:    ${summary.session.exactMatch}`);
    }
    console.log(
      `  raw: ${summary.rawBytes} bytes, events: ${summary.eventCount}, screenshots: ${summary.screenshots.length}`,
    );
  }
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(`[live] FATAL: ${error.message}`);
  process.exit(2);
});