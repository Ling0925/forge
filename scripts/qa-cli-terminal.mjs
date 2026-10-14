#!/usr/bin/env node
/**
 * qa-cli-terminal.mjs — real-PTY + xterm.js visual acceptance harness for the
 * Forge CLI redesign (QA support only; owns no product code).
 *
 * What it does:
 *  - Runs a target CLI in a REAL pseudo-terminal via .build/qa-pty-helper.py
 *    (python3 stdlib pty; no native compile), capturing the RAW ANSI byte
 *    stream exactly as emitted.
 *  - Replays that raw stream into xterm.js in a real Chromium page and
 *    screenshots the rendered terminal (never a <pre> text screenshot).
 *  - Drives scenario behaviors (startup, /help, model picker, CJK/emoji long
 *    input, streaming, tool start/result, approval paste-denial + fresh input,
 *    resize, Ctrl+C, exit, NO_COLOR, TERM=dumb) and emits pattern/behavior
 *    based checks computed from the RENDERED screen text and raw bytes.
 *  - Serves a local fixture model API (chat-completions streaming) so no
 *    external model requests happen unless --live is passed by root.
 *
 * Everything (PTY child, python helper, browser, HTTP server, temp homes) is
 * cleaned up in a finally block.
 *
 * Usage:
 *   node scripts/qa-cli-terminal.mjs --cli dist/cli.mjs [--suite startup|full|v2]
 *     [--evidence-dir DIR] [--cols 120,80,40] [--themes light,dark]
 *     [--soft] [--keep] [--codex] [--live] [--chrome PATH] [--xterm-root DIR]
 *
 * Exit code: 0 when no check failed (or --soft), 1 otherwise.
 * QA-owned file: scripts/qa-cli-*.mjs only.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoveryFixture } from "./cli-qa/v2-discovery.mjs";
import { v2Scenarios, v2Checks, v2Context } from "./cli-qa/v2.mjs";
import { extendedScenarios, handleExtendedFixture } from "./cli-qa/v2-extended.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DEFAULT_CHROME =
  "/home/ling/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const FIXTURE_TEXT_REPLY = "QA-FIXTURE-REPLY 你好 🎉";
const FIXTURE_STREAM_OK = "QA-FIXTURE-STREAM-OK ✅ 流式完成";
const FIXTURE_SLOW_TAIL = "QA-FIXTURE-SLOW-TAIL";
const FIXTURE_TOOL_ECHO = "qa-tool-result-echo";
const TOOL_RESULT_SEEN = "QA-FIXTURE-TOOL-RESULT-SEEN";
const TOOL_RESULT_MISSING = "QA-FIXTURE-TOOL-RESULT-MISSING";
const APPROVE_DONE = "QA-FIXTURE-APPROVE-DONE";

// ---------------------------------------------------------------- args ----

function usage() {
  return [
    "qa-cli-terminal.mjs — real PTY + xterm.js acceptance harness",
    "  --cli PATH          target CLI (dist/cli.mjs or installed bin) [required]",
    "  --suite NAME        startup | full (legacy) | v2 (smoke) [default: startup]",
    "  --scenario NAME     run one scenario from the selected suite",
    "  --evidence-dir DIR  where screenshots/summary land [default: .omo/evidence/cli-terminal-qa/<ts>]",
    "  --cols LIST         terminal widths [default: 120,80,40]",
    "  --themes LIST       xterm render themes [default: light,dark]",
    "  --soft              always exit 0 (UX still evolving)",
    "  --keep              keep temp homes/workspaces for debugging",
    "  --core-only         v2: omit independent extended scenarios",
    "  --codex             also capture codex --no-alt-screen initial view (reference only)",
    "  --live              allow external model requests (root only)",
    "  --chrome PATH       chromium binary [default: playwright chromium-1248]",
    "  --xterm-root DIR    dir containing @xterm/xterm + @xterm/addon-fit",
  ].join("\n");
}

function parseList(value) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    cli: null,
    suite: "startup",
    scenario: null,
    coreOnly: false,
    evidenceDir: null,
    cols: [120, 80, 40],
    themes: ["light", "dark"],
    soft: false,
    keep: false,
    codex: false,
    live: false,
    chrome: process.env.QA_CHROME || DEFAULT_CHROME,
    xtermRoot: process.env.XTERM_ROOT || null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--cli":
        args.cli = next();
        break;
      case "--core-only":
        args.coreOnly = true;
        break;
      case "--scenario":
        args.scenario = next();
        break;
      case "--suite":
        args.suite = next();
        break;
      case "--evidence-dir":
        args.evidenceDir = next();
        break;
      case "--cols":
        args.cols = parseList(next()).map(Number);
        break;
      case "--themes":
        args.themes = parseList(next());
        break;
      case "--soft":
        args.soft = true;
        break;
      case "--keep":
        args.keep = true;
        break;
      case "--codex":
        args.codex = true;
        break;
      case "--live":
        args.live = true;
        break;
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
  if (!["startup", "full", "v2"].includes(args.suite)) {
    console.error("--suite must be startup, full or v2");
    process.exit(2);
  }
  if (args.scenario && !SUITES[args.suite].some(([name]) => name === args.scenario)) throw new Error("scenario not in suite");
  if (args.suite === "v2" && args.soft) throw new Error("v2 acceptance forbids --soft");
  args.cli = resolve(ROOT, args.cli);
  return args;
}

// ------------------------------------------------------- xterm assets ----

async function resolveXterm(explicit) {
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
    if (existsSync(join(xtermDir, "lib", "xterm.mjs")) && existsSync(join(fitDir, "lib", "addon-fit.mjs"))) {
      return {
        source: base,
        xtermDir,
        fitDir,
        fetched: false,
      };
    }
  }
  // Last resort: fetch official npm tarballs into .build/qa-deps (no manifest change).
  const depDir = join(ROOT, ".build", "qa-deps");
  await mkdir(depDir, { recursive: true });
  const pack = spawnSync(
    "npm",
    ["pack", "@xterm/xterm", "@xterm/addon-fit", "--pack-destination", depDir, "--silent"],
    { cwd: depDir, encoding: "utf8", timeout: 120000 },
  );
  if (pack.status !== 0) {
    throw new Error(
      `xterm not resolvable and npm pack failed: ${pack.stderr?.slice(0, 400)}`,
    );
  }
  const tarballs = pack.stdout.trim().split("\n").filter(Boolean);
  for (const tarball of tarballs) {
    const name = tarball.includes("addon-fit") ? "addon-fit" : "xterm";
    const dest = join(depDir, "@xterm", name);
    await mkdir(dest, { recursive: true });
    const untar = spawnSync(
      "tar",
      ["-xzf", join(depDir, tarball), "-C", dest, "--strip-components=1"],
      { encoding: "utf8" },
    );
    if (untar.status !== 0) throw new Error(`untar failed for ${tarball}`);
  }
  return {
    source: `${depDir} (fetched via npm pack)`,
    xtermDir: join(depDir, "@xterm", "xterm"),
    fitDir: join(depDir, "@xterm", "addon-fit"),
    fetched: true,
  };
}

// Capture-only official provider: local extraction by root, never a network fallback.
async function resolveUnicode11() {
  const dir = join(ROOT, ".build/qa-deps/@xterm/addon-unicode11");
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  if (pkg.name !== "@xterm/addon-unicode11" || pkg.version !== "0.9.0") {
    throw new Error("capture requires official @xterm/addon-unicode11@0.9.0 locally");
  }
  const asset = join(dir, "lib/addon-unicode11.mjs");
  const bytes = await readFile(asset); // Missing local asset fails closed.
  return { asset, package: pkg.name, version: pkg.version, activeVersion: "11",
    source: dir, repository: pkg.repository, commit: pkg.commit,
    sha256: createHash("sha256").update(bytes).digest("hex"), fetched: false };
}

// -------------------------------------------------- fixture model API ----
// Local-only OpenAI-compatible chat-completions fixture. Behavior is selected
// by explicit markers in the user prompt ([qa-stream], [qa-tool], [qa-approve],
// [qa-slow]); every request is recorded as fixture evidence.

function classifyFixture(lastUser) {
  const text = typeof lastUser === "string" ? lastUser : JSON.stringify(lastUser ?? "");
  if (text.includes("[qa-v2-approval]")) return "v2approval";
  if (text.includes("[qa-slow]")) return "slow";
  if (text.includes("[qa-tool]")) return "tool";
  if (text.includes("[qa-approve]")) return "approve";
  if (text.includes("[qa-stream]")) return "stream";
  return "plain";
}

function sseChunk(delta, finish) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-qa-fixture",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "qa-fixture-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function toolCallChunks(id, name, argsText) {
  const chunks = [];
  chunks.push(
    sseChunk(
      {
        role: "assistant",
        tool_calls: [
          { index: 0, id, type: "function", function: { name, arguments: "" } },
        ],
      },
      null,
    ),
  );
  for (let i = 0; i < argsText.length; i += 24) {
    chunks.push(
      sseChunk(
        {
          tool_calls: [
            {
              index: 0,
              function: { arguments: argsText.slice(i, i + 24) },
            },
          ],
        },
        null,
      ),
    );
  }
  chunks.push(sseChunk({}, "tool_calls"));
  chunks.push("data: [DONE]\n\n");
  return chunks;
}

async function fixtureHandler(req, res, log) {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: Array.from({ length: 15 }, (_, i) => ({ id: `qa-v2-model-${String(i + 1).padStart(3, "0")}`, object: "model" })),
      }),
    );
    return;
  }
  if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "qa fixture: unknown route" } }));
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    /* keep {} */
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content;
  const scenario = classifyFixture(lastUser);
  const currentMessages = messages.slice(messages.findLastIndex(m => m.role === "user") + 1);
  const hasToolResult = currentMessages.some((m) => m.role === "tool" || m.role === "function");
  log.push({
    at: new Date().toISOString(),
    scenario,
    hasToolResult,
    stream: Boolean(body.stream),
    messageCount: messages.length,
    model: body.model ?? null,
    lastUser,
    messages,
  });

  const stream = Boolean(body.stream);
  res.writeHead(200, {
    "content-type": stream ? "text/event-stream" : "application/json",
    "cache-control": "no-cache",
  });

  const textReply = (text) =>
    stream
      ? [sseChunk({ role: "assistant", content: text }, null), sseChunk({}, "stop"), "data: [DONE]\n\n"]
      : [
          JSON.stringify({
            id: "chatcmpl-qa-fixture",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: text },
                finish_reason: "stop",
              },
            ],
          }),
        ];

  if (await handleExtendedFixture({ lastUser, messages, res, log, sseChunk, toolCallChunks, textReply })) return;

  if (scenario === "slow") {
    // First chunk now, tail after a long stall (Ctrl+C interruption target).
    res.write(sseChunk({ role: "assistant", content: "QA-FIXTURE-SLOW-HEAD ..." }, null));
    const timer = setTimeout(() => {
      res.write(sseChunk({ role: "assistant", content: FIXTURE_SLOW_TAIL }, null));
      res.write(sseChunk({}, "stop"));
      res.write("data: [DONE]\n\n");
      res.end();
    }, 25000);
    res.on("close", () => { clearTimeout(timer); log.push({ scenario: "slow", responseClosed: true, responseClosedAt: Date.now(), completed: res.writableEnded }); });
    return;
  }
  if (scenario === "tool" && !hasToolResult) {
    const payload = JSON.stringify({ path: "fixture-echo.txt" });
    for (const chunk of toolCallChunks("call_qa_tool_1", "read_file", payload)) res.write(chunk);
    res.end();
    return;
  }
  if (scenario === "v2approval" && !hasToolResult) {
    const payload = JSON.stringify({ argv: [process.execPath, "-e", "require(\"node:fs\").appendFileSync(\"qa-approval-counter\",\"x\")"] });
    for (const chunk of toolCallChunks("call_v2_approve_001", "run_command", payload)) res.write(chunk);
    res.end(); return;
  }
  if (scenario === "v2approval" && hasToolResult) {
    const tool = [...currentMessages].reverse().find(m => m.role === 'tool');
    let envelope; let command;
    try { envelope = JSON.parse(tool.content); command = JSON.parse(envelope.content); } catch {}
    const ok = envelope?.isError === false && command?.exit_code === 0 && !command?.spawn_failed && !command?.timed_out && command?.signal == null;
    log[log.length - 1].approvalValidation = { ok, envelope, command };
    for (const chunk of textReply(ok ? "QA-V2-APPROVAL-RESULT" : "QA-V2-APPROVAL-DENIED")) res.write(chunk);
    res.end(); return;
  }
  if (scenario === "approve" && !hasToolResult) {
    const payload = JSON.stringify({ argv: ["node", "--version"] });
    for (const chunk of toolCallChunks("call_qa_approve_1", "run_command", payload)) res.write(chunk);
    res.end();
    return;
  }
  if (scenario === "tool" && hasToolResult) {
    const toolMsg = [...messages].reverse().find((m) => m.role === "tool");
    const seen = JSON.stringify(toolMsg?.content ?? "").includes(FIXTURE_TOOL_ECHO);
    for (const chunk of textReply(seen ? TOOL_RESULT_SEEN : TOOL_RESULT_MISSING)) res.write(chunk);
    res.end();
    return;
  }
  if (scenario === "approve" && hasToolResult) {
    const toolMsg = [...messages].reverse().find(m => m.role === "tool" || m.role === "function");
    let result = toolMsg?.content;
    try { if (typeof result === "string") result = JSON.parse(result); } catch {}
    // ToolResult envelopes carry serialized command fields in content.
    // An error envelope must never produce the approval success marker.
    const envelopeError = result?.isError === true;
    if (result && typeof result === "object" && "content" in result) {
      if (result.isError === false && typeof result.content === "string") {
        try { result = JSON.parse(result.content); } catch { result = null; }
      } else result = null;
    }
    const ok = !envelopeError && typeof result?.stdout === "string" && /^v\d+\.\d+\.\d+\s*$/.test(result.stdout) && result.exit_code === 0 && !result.timed_out && !result.spawn_failed && !result.truncated && result.signal == null;
    log[log.length - 1].versionValidation = { ok, result };
    for (const chunk of textReply(ok ? APPROVE_DONE : "QA-FIXTURE-APPROVE-INVALID")) res.write(chunk);
    res.end();
    return;
  }
  if (scenario === "stream") {
    const observation = log[log.length - 1];
    observation.responseStarted = Date.now();
    const words = ["QA-FIXTURE-STREAM", "正在", "逐块", "输出", "streamed", "chunks", FIXTURE_STREAM_OK];
    (async () => {
      for (const word of words) {
        res.write(sseChunk({ role: "assistant", content: `${word} ` }, null));
        await new Promise((r) => setTimeout(r, word === "QA-FIXTURE-STREAM" ? 4500 : 180));
      }
      observation.responseCompleted = Date.now();
      res.write(sseChunk({}, "stop"));
      res.write("data: [DONE]\n\n");
      res.end();
    })();
    return;
  }
  for (const chunk of textReply(FIXTURE_TEXT_REPLY)) res.write(chunk);
  res.end();
}

// ---------------------------------------------------- xterm render page --

const RENDER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/assets/xterm/xterm.css">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #host { display: inline-block; padding: 12px; }
  /* Match width-cache repeated glyphs to rendered CJK runs: Chromium
     otherwise trims repeated fullwidth punctuation during measurement only. */
  .xterm { text-spacing-trim: space-all; }
</style>
</head>
<body>
<div id="host"></div>
<script type="module">
import { Terminal } from "/assets/xterm/xterm.mjs";
import { FitAddon } from "/assets/xterm/addon-fit.mjs";
import { Unicode11Addon } from "/assets/xterm/addon-unicode11.mjs";
let term = null;
let unicodeProbe = null;
function useUnicode11(terminal) {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
}
async function probeUnicode11() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const probe = new Terminal({ cols: 40, rows: 2, allowProposedApi: true });
  try {
    useUnicode11(probe);
    probe.open(host);
    await new Promise(done => probe.write('中 🎉 e\\u0301 X', done));
    const buf = probe.buffer.active;
    const line = buf.getLine(0);
    const cells = Array.from({length: 9}, (_, x) => {
      const cell = line.getCell(x);
      return { chars: cell.getChars(), width: cell.getWidth() };
    });
    const expected = [['中',2],['',0],[' ',1],['🎉',2],['',0],[' ',1],['e\\u0301',1],[' ',1],['X',1]];
    if (probe.unicode.activeVersion !== '11' || buf.cursorX !== 9 || buf.cursorY !== 0 ||
        cells.some((cell,x) => cell.chars !== expected[x][0] || cell.width !== expected[x][1])) {
      throw new Error('Unicode11 browser cell sanity mismatch: ' + JSON.stringify({cells, x:buf.cursorX, y:buf.cursorY}));
    }
    return { activeVersion: probe.unicode.activeVersion, sample: '中 🎉 e\\u0301 X', cells, cursor: {x:buf.cursorX,y:buf.cursorY} };
  } finally {
    probe.dispose();
    host.remove();
  }
}
window.__qa = {
  async init(cols, rows, theme) {
    unicodeProbe = await probeUnicode11();
    if (term) term.dispose();
    const themes = {
      dark: { background: "#101014", foreground: "#e8e8ec", cursor: "#e8e8ec" },
      light: { background: "#fbfbfd", foreground: "#20202a", cursor: "#20202a" },
    };
    term = new Terminal({
      cols, rows,
      fontSize: 15,
      fontFamily: "monospace",
      cursorBlink: false,
      convertEol: false,
      scrollback: 4000,
      theme: themes[theme] || themes.dark,
      allowProposedApi: true,
    });
    useUnicode11(term);
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
  resize(cols, rows) {
    term.resize(cols, rows);
  },
  state() {
    const buf = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buf.length; i += 1) {
      lines.push((buf.getLine(i) ? buf.getLine(i).translateToString(true) : ""));
    }
    const viewport = [];
    const cells = [];
    const wrapped = [];
    for (let y = 0; y < term.rows; y++) {
      const line = buf.getLine(buf.viewportY + y);
      wrapped.push(Boolean(line?.isWrapped));
      viewport.push(line ? line.translateToString(false) : "");
      cells.push(Array.from({ length: term.cols }, (_, x) => {
        const cell = line?.getCell(x);
        return { chars: cell?.getChars() || "", width: cell?.getWidth() ?? 1, inverse: Boolean(cell?.isInverse()) };
      }));
    }
    return {
      viewport, cells, wrapped,
      renderer: { type: "xterm DOM", fontFamily: term.options.fontFamily, textSpacingTrim: getComputedStyle(term.element).textSpacingTrim, dpr: devicePixelRatio },
      unicode: { activeVersion: term.unicode.activeVersion, probe: unicodeProbe },
      text: lines.join("\\n"),
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

// ------------------------------------------------------------- helpers ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

// --------------------------------------------------------------- checks --

const CHECKS = {
  slash_popup(screens) {
    const open = screens["slash-open"] || "";
    const filtered = screens["slash-filtered"] || "";
    const escaped = screens["slash-escaped"] || "";
    // The persistent header mentions /help; only rows BELOW the composer
    // are popup evidence. The initial six-row menu need not contain /help.
    const belowComposer = (screen, draft) => {
      const lines = screen.split("\n");
      const index = lines.findLastIndex(line => line.trim() === `❯ ${draft}`);
      return index < 0 ? null : lines.slice(index + 1).filter(line => line.trim());
    };
    const openRows = belowComposer(open, "/");
    const filteredRows = belowComposer(filtered, "/he");
    const escapedRows = belowComposer(escaped, "/he");
    const menuCommand = /^\s*(?:❯\s+)?\/[a-z][\w-]*\s+\S/;
    const ok = openRows !== null && filteredRows !== null && escapedRows !== null &&
      openRows.filter(line => menuCommand.test(line)).length >= 2 &&
      openRows.some(line => /\/model\s+\S/.test(line)) &&
      filteredRows.filter(line => menuCommand.test(line)).length === 1 &&
      filteredRows.some(line => /\/help\s+\S/.test(line)) &&
      escapedRows.length === 0; // Any residual menu/footer below draft fails.
    return { status: ok ? "pass" : "fail", observed: `popup opens, filters, Escape preserves draft and dismisses: ${ok}` };
  },
  startup_compact(screen) {
    const usageLines = countMatches(
      screen,
      /^[^\n]*(usage|options|commands|--help|--model|--permission)[^\n]*$/gim,
    );
    return {
      status: usageLines <= 8 ? "pass" : "fail",
      observed: `usage/options-like lines on startup screen: ${usageLines} (threshold 8)`,
    };
  },
  startup_rendered(screen) {
    const nonEmpty = screen.split("\n").filter((l) => l.trim()).length;
    return {
      status: nonEmpty >= 1 && screen.length > 0 ? "pass" : "fail",
      observed: `rendered startup screen has ${nonEmpty} non-empty lines, ${screen.length} chars`,
    };
  },
  help_lists_commands(screen) {
    const commandLines = countMatches(screen, /(^|\s)\/[a-z][\w-]*/gim);
    return {
      status: commandLines >= 3 ? "pass" : "fail",
      observed: `lines mentioning /command tokens: ${commandLines} (threshold 3)`,
    };
  },
  help_changed(screens) {
    const changed = screens.help !== screens.startup;
    return {
      status: changed ? "pass" : "fail",
      observed: changed
        ? "screen content changed after /help"
        : "screen did not change after /help",
    };
  },
  picker_reacted(screens) {
    const changed = screens["model-list"] !== screens.startup;
    return {
      status: changed ? "pass" : "fail",
      observed: changed
        ? "screen changed after /model (picker/list responded)"
        : "no visible reaction to /model",
    };
  },
  picker_set_model(screen) {
    return {
      status: screen.includes("qa-fixture-model") ? "pass" : "fail",
      observed: screen.includes("qa-fixture-model")
        ? "selected fixture model name visible on screen"
        : "fixture model name not visible after selection",
    };
  },
  long_input_no_mojibake(screens) {
    const all = Object.values(screens).join("\n");
    return {
      status: all.includes("\uFFFD") ? "fail" : "pass",
      observed: `U+FFFD replacement chars in rendered screens: ${countMatches(all, /\uFFFD/g)}`,
    };
  },
  long_input_roundtrip(screens) {
    const done = screens["long-input-done"] || "";
    return {
      status: done.includes(FIXTURE_TEXT_REPLY) ? "pass" : "fail",
      observed: done.includes(FIXTURE_TEXT_REPLY)
        ? "fixture reply rendered after CJK/emoji long input (full round trip)"
        : "fixture reply marker not observed after long input",
    };
  },
  stream_progressive(screens) {
    const states = [screens["stream-early"], screens["stream-mid"], screens["stream-done"]];
    const distinct = new Set(states.filter(Boolean)).size;
    return {
      status: distinct >= 2 ? "pass" : "fail",
      observed: `distinct rendered snapshots across stream marks: ${distinct}/3`,
    };
  },
  stream_final_marker(screens) {
    return {
      status: screens["stream-done"]?.includes(FIXTURE_STREAM_OK) ? "pass" : "fail",
      observed: screens["stream-done"]?.includes(FIXTURE_STREAM_OK)
        ? "final fixture stream marker rendered"
        : "final stream marker not observed",
    };
  },
  tool_start_visible(screens) {
    return {
      status: screens["tool-start"]?.includes("read_file") ? "pass" : "fail",
      observed: screens["tool-start"]?.includes("read_file")
        ? "tool name visible at tool-start mark"
        : "tool name not visible at tool-start mark",
    };
  },
  tool_result_visible(screens) {
    return {
      status: screens["tool-result"]?.includes(TOOL_RESULT_SEEN) ? "pass" : "fail",
      observed: screens["tool-result"]?.includes(TOOL_RESULT_SEEN)
        ? "tool result marker rendered (fixture saw tool result)"
        : "tool result marker missing",
    };
  },
  approval_prompt_appeared(screens) {
    const screen = screens["approval-pending"] || "";
    const hit = /approve\?|\[y\/N\]|allow|permit|deny/i.test(screen);
    return {
      status: hit ? "pass" : "fail",
      observed: hit
        ? "approval affordance observed at approval-pending mark"
        : "no approval affordance observed (see screenshot)",
    };
  },
  // Stale-input protection: a `y` buffered BEFORE the prompt existed (queued
  // paste line plus an unfinished fragment) must not authorize the call.
  approval_stale_input_denied(screens) {
    const screen = screens["approval-stale-window"] || "";
    const executed = /v22\.\d/.test(screen) || screen.includes(APPROVE_DONE);
    return {
      status: executed ? "fail" : "pass",
      observed: executed
        ? "queued y typed BEFORE the prompt authorized the call (stale input not discarded)"
        : "queued y + unfinished y buffered before the prompt did not authorize execution",
    };
  },
  // A `y` typed AFTER the prompt is on screen is legitimate consent.
  approval_fresh_input_authorized(screens, raw) {
    const screen = screens["approval-approved"] || "";
    const ran = screen.includes(APPROVE_DONE);
    const fixtureSawToolResult = raw.includes(APPROVE_DONE);
    return {
      status: ran && fixtureSawToolResult ? "pass" : "fail",
      observed: `fresh y+Enter after prompt: validated version marker rendered=${ran}, fixture approve-done=${fixtureSawToolResult}`,
    };
  },
  resize_orderly(screens) {
    const entries = [
      ["resize-80", 80],
      ["resize-40", 40],
    ];
    const problems = [];
    for (const [mark, cols] of entries) {
      const screen = screens[mark];
      if (!screen) {
        problems.push(`${mark} missing`);
        continue;
      }
      const widest = Math.max(...screen.split("\n").map((l) => l.length), 0);
      if (widest > cols + 2) problems.push(`${mark} widest line ${widest} > ${cols}+2`);
      if (screen.includes("\uFFFD")) problems.push(`${mark} has U+FFFD`);
    }
    return {
      status: problems.length ? "fail" : "pass",
      observed: problems.length ? problems.join("; ") : "lines re-flowed within new widths, no mojibake",
    };
  },
  interrupt_stops_stream(screens, raw) {
    const tailSeen =
      raw.includes(FIXTURE_SLOW_TAIL) ||
      Object.values(screens).some((s) => s.includes(FIXTURE_SLOW_TAIL));
    return {
      status: !tailSeen && screens["slow-running"]?.includes("QA-FIXTURE-SLOW-HEAD") && screens.recovered?.includes(FIXTURE_TEXT_REPLY) ? "pass" : "fail",
      observed: tailSeen
        ? "stream tail arrived despite Ctrl+C"
        : "requires observed slow head and successful recovery reply; tail absent",
    };
  },
  interrupt_returns_prompt(screens) {
    const changed = screens["after-interrupt"] !== screens["slow-running"];
    return {
      status: changed ? "pass" : "fail",
      observed: changed
        ? "screen changed after Ctrl+C (interrupt handled)"
        : "screen frozen after Ctrl+C",
    };
  },
  graceful_exit(_screens, _raw, exitInfo) {
    return {
      status: exitInfo.done && exitInfo.code === 0 ? "pass" : "fail",
      observed: `after /exit: exited=${exitInfo.done} code=${exitInfo.code} signal=${exitInfo.signal}`,
    };
  },
  ctrl_c_exit(_screens, _raw, exitInfo) {
    const clean = exitInfo.done && (exitInfo.code === 0 || exitInfo.code === 130);
    return {
      status: clean ? "pass" : "fail",
      observed: `after Ctrl+C at idle: exited=${exitInfo.done} code=${exitInfo.code} signal=${exitInfo.signal}`,
    };
  },
  no_color_no_sgr(_screens, raw) {
    const sgr = raw.match(/\x1b\[[0-9;]*m/g) || [];
    const colored = sgr.filter((seq) => {
      const params = seq.slice(2, -1);
      return params
        .split(";")
        .some((p) => p !== "" && Number(p) >= 30 && Number(p) <= 99 && Number(p) !== 39 && Number(p) !== 49);
    });
    return {
      status: colored.length === 0 ? "pass" : "fail",
      observed: `SGR sequences: ${sgr.length}, color-parameterized: ${colored.length}`,
    };
  },
  term_dumb_no_escape(_screens, raw) {
    const count = countMatches(raw, /\x1b/g);
    return {
      status: count === 0 ? "pass" : "fail",
      observed: `ESC bytes in raw PTY output with TERM=dumb: ${count}`,
    };
  },
};

// --------------------------------------------------------- scenarios ----

const LONG_CJK_INPUT =
  "验收长输入：中文段落与 emoji 🎉🚀 混排 " +
  "0123456789ABCDEF".repeat(4) +
  " 尾部结束 ✅";

function cliCmd(ctx, extra = []) {
  return [process.execPath, ctx.cli, "chat", "--workspace", ctx.wsDir, ...extra];
}

function startSteps() {
  return [
    { action: "wait_quiet", ms: 900, timeout_ms: 12000, name: "startup-quiet" },
    { action: "mark", name: "startup" },
  ];
}

// Ordinary exit is the real product command `/quit`; no Ctrl+C fallbacks, so a
// CLI that cannot leave the prompt on `/quit` is reported as a failure instead
// of being masked by a signal-based kill.
function exitSteps() {
  return [
    { action: "type", text: "/quit" },
    { action: "key", name: "enter" },
    { action: "wait_exit", timeout_ms: 8000 },
    { action: "mark", name: "final" },
  ];
}

const SCENARIOS = {
  ...v2Scenarios,
  "slash-popup": {
    describe: "slash popup opens, filters, Escape dismisses preserving draft",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "/" },
      { action: "wait", ms: 400 },
      { action: "mark", name: "slash-open" },
      { action: "type", text: "he" },
      { action: "wait", ms: 400 },
      { action: "mark", name: "slash-filtered" },
      { action: "key", name: "esc" },
      { action: "wait", ms: 500 },
      { action: "mark", name: "slash-escaped" },
      { action: "key", name: "ctrl-u" },
      ...exitSteps(),
    ],
    checks: ["slash_popup"],
  },
  startup: {
    describe: "startup compactness + /help + graceful exit",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "/help" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 900, timeout_ms: 8000, name: "help-quiet" },
      { action: "mark", name: "help" },
      ...exitSteps(),
    ],
    checks: ["startup_compact", "startup_rendered", "help_lists_commands", "help_changed", "graceful_exit"],
  },
  "model-picker": {
    describe: "model picker follows the real available UI (/model list + set)",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "/model" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 900, timeout_ms: 8000, name: "model-list-quiet" },
      { action: "mark", name: "model-list" },
      { action: "type", text: "/model qa-fixture-model" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 900, timeout_ms: 8000, name: "model-set-quiet" },
      { action: "mark", name: "model-set" },
      ...exitSteps(),
    ],
    checks: ["picker_reacted", "picker_set_model"],
  },
  "long-input": {
    describe: "CJK + emoji long input round trip through fixture API",
    steps: () => [
      ...startSteps(),
      { action: "type", text: LONG_CJK_INPUT },
      { action: "mark", name: "long-input" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 1500, timeout_ms: 15000, name: "long-reply-quiet" },
      { action: "mark", name: "long-input-done" },
      ...exitSteps(),
    ],
    checks: ["long_input_no_mojibake", "long_input_roundtrip"],
  },
  stream: {
    describe: "streaming assistant output (fixture SSE stream)",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "[qa-stream] 流式测试" },
      { action: "key", name: "enter" },
      { action: "wait", ms: 500 },
      { action: "mark", name: "stream-early" },
      { action: "wait", ms: 700 },
      { action: "mark", name: "stream-mid" },
      {
        action: "wait_for",
        name: "stream-done-wait",
        pattern: "QA-FIXTURE-STREAM-OK",
        timeout_ms: 15000,
      },
      { action: "wait_quiet", ms: 700, timeout_ms: 6000, name: "stream-quiet" },
      { action: "mark", name: "stream-done" },
      ...exitSteps(),
    ],
    checks: ["stream_progressive", "stream_final_marker"],
  },
  tool: {
    describe: "tool start + tool result rendering (fixture read_file call)",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "[qa-tool] 读取 fixture-echo.txt" },
      { action: "key", name: "enter" },
      {
        action: "wait_for",
        name: "tool-start-wait",
        pattern: "read_file",
        timeout_ms: 15000,
      },
      { action: "mark", name: "tool-start" },
      {
        action: "wait_for",
        name: "tool-result-wait",
        pattern: "QA-FIXTURE-TOOL-RESULT-(SEEN|MISSING)",
        timeout_ms: 20000,
      },
      { action: "wait_quiet", ms: 700, timeout_ms: 6000, name: "tool-quiet" },
      { action: "mark", name: "tool-result" },
      ...exitSteps(),
    ],
    checks: ["tool_start_visible", "tool_result_visible"],
  },
  approval: {
    // workspace permission is required: readonly denies run_command outright
    // (no approval prompt can ever appear), so the old readonly setup could
    // never exercise consent at all.
    describe: "approval consent: stale pre-prompt y rejected, fresh post-prompt y authorized",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "/permission workspace" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 700, timeout_ms: 6000, name: "perm-quiet" },
      // Stale-consent probe: the triggering line AND a queued `y` + unfinished
      // `y` fragment are all written before the fixture can respond, so none of
      // it can be a legitimate answer to the approval prompt that arrives later.
      { action: "type", text: "[qa-approve] 运行 node --version", no_drain: true },
      { action: "key", name: "enter", no_drain: true },
      { action: "type", text: "y", no_drain: true },
      { action: "key", name: "enter", no_drain: true },
      { action: "type", text: "y", no_drain: true },
      { action: "wait", ms: 400 },
      {
        action: "wait_for",
        name: "approval-wait",
        pattern: "Approve\\?|\\[y/N\\]",
        timeout_ms: 20000,
        after_mark: "startup",
      },
      { action: "wait_quiet", ms: 500, timeout_ms: 4000, name: "approval-quiet" },
      { action: "mark", name: "approval-pending" },
      // No execution must have happened from the buffered/pre-prompt input.
      { action: "wait", ms: 1200 },
      { action: "mark", name: "approval-stale-window" },
      // A y typed AFTER the prompt is on screen is legitimate consent.
      { action: "type", text: "y" },
      { action: "key", name: "enter" },
      {
        action: "wait_for",
        name: "approve-result-wait",
        pattern: APPROVE_DONE,
        timeout_ms: 15000,
        after_mark: "approval-stale-window",
      },
      { action: "wait_quiet", ms: 700, timeout_ms: 6000, name: "approve-quiet" },
      { action: "mark", name: "approval-approved" },
      ...exitSteps(),
    ],
    checks: [
      "approval_prompt_appeared",
      "approval_stale_input_denied",
      "approval_fresh_input_authorized",
    ],
  },
  resize: {
    describe: "live resize 120 -> 80 -> 40 with CJK content on the input line",
    steps: () => [
      ...startSteps(),
      { action: "type", text: LONG_CJK_INPUT },
      { action: "resize", cols: 80, rows: 30 },
      { action: "wait_quiet", ms: 800, timeout_ms: 6000, name: "resize80-quiet" },
      { action: "mark", name: "resize-80" },
      { action: "resize", cols: 40, rows: 30 },
      { action: "wait_quiet", ms: 800, timeout_ms: 6000, name: "resize40-quiet" },
      { action: "mark", name: "resize-40" },
      { action: "key", name: "ctrl-c" },
      ...exitSteps(),
    ],
    checks: ["resize_orderly"],
  },
  "ctrl-c": {
    describe: "Ctrl+C while streaming + Ctrl+C at idle",
    steps: () => [
      ...startSteps(),
      { action: "type", text: "[qa-slow] 慢速流" },
      { action: "key", name: "enter" },
      { action: "wait_for", name: "slow-head", pattern: "QA-FIXTURE-SLOW-HEAD", timeout_ms: 10000, after_mark: "startup" },
      { action: "mark", name: "slow-running" },
      { action: "key", name: "ctrl-c" },
      { action: "wait_quiet", ms: 1200, timeout_ms: 6000, name: "interrupt-quiet" },
      { action: "mark", name: "after-interrupt" },
      { action: "type", text: "[qa-recovery] next request" },
      { action: "key", name: "enter" },
      { action: "wait_for", name: "recovery", pattern: "QA-FIXTURE-REPLY", timeout_ms: 10000, after_mark: "after-interrupt" },
      { action: "wait_quiet", ms: 700, timeout_ms: 4000 },
      { action: "mark", name: "recovered" },
      { action: "key", name: "ctrl-c" },
      { action: "wait_quiet", ms: 600, timeout_ms: 4000, name: "idle1-quiet" },
      { action: "mark", name: "idle-ctrlc-1" },
      { action: "key", name: "ctrl-c" },
      { action: "wait_exit", timeout_ms: 5000 },
      { action: "mark", name: "exited" },
    ],
    checks: ["interrupt_stops_stream", "interrupt_returns_prompt", "ctrl_c_exit"],
  },
  "no-color": {
    describe: "NO_COLOR=1 output contains no color SGR",
    env: { NO_COLOR: "1" },
    steps: () => [
      ...startSteps(),
      { action: "type", text: "/help" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 900, timeout_ms: 8000, name: "help-quiet" },
      { action: "mark", name: "help" },
      ...exitSteps(),
    ],
    checks: ["no_color_no_sgr"],
  },
  "term-dumb": {
    describe: "TERM=dumb output contains no escape sequences",
    env: { TERM: "dumb" },
    steps: () => [
      ...startSteps(),
      { action: "type", text: "/help" },
      { action: "key", name: "enter" },
      { action: "wait_quiet", ms: 900, timeout_ms: 8000, name: "help-quiet" },
      { action: "mark", name: "help" },
      ...exitSteps(),
    ],
    checks: ["term_dumb_no_escape"],
  },
};

const SUITES = {
  startup: [
    ["startup", "all"],
    ["no-color", [120]],
    ["term-dumb", [120]],
  ],
  v2: Object.keys(v2Scenarios).map(name => [name, ["v2-startup", "v2-menu", "v2-model", "v2-resume", "v2-model-discovery"].includes(name) || name in extendedScenarios ? "all" : [120]]),
  full: [
    ["slash-popup", "all"],
    ["startup", "all"],
    ["model-picker", [120]],
    ["long-input", "all"],
    ["stream", [120, 80]],
    ["tool", [120]],
    ["approval", [120]],
    ["resize", [120]],
    ["ctrl-c", [120]],
    ["no-color", "all"],
    ["term-dumb", "all"],
  ],
};

// ------------------------------------------------------------- runtime ---

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const evidenceDir = args.evidenceDir
    ? resolve(ROOT, args.evidenceDir)
    : join(ROOT, ".omo", "evidence", "cli-terminal-qa", stamp);
  if (args.evidenceDir && existsSync(evidenceDir)) throw new Error("evidence directory already exists; use a unique path");
  await mkdir(evidenceDir, { recursive: true });

  const cliStat = await readFile(args.cli).catch(() => null);
  if (!cliStat) {
    console.error(`--cli not readable: ${args.cli}`);
    process.exit(2);
  }
  const cliSha = createHash("sha256").update(cliStat).digest("hex");

  const unicode11 = await resolveUnicode11();
  const xterm = await resolveXterm(args.xtermRoot);
  const { chromium } = await import("playwright");

  const tmpRoot = await mkdtemp(join(tmpdir(), "forge-cli-terminal-qa-"));
  const forgeHome = join(tmpRoot, "forge-home");
  const wsDir = join(tmpRoot, "workspace");
  await mkdir(forgeHome, { recursive: true, mode: 0o700 });
  await mkdir(wsDir, { recursive: true });
  await writeFile(
    join(wsDir, "fixture-echo.txt"),
    `fixture ${FIXTURE_TOOL_ECHO}\n`,
    "utf8",
  );

  const fixtureLog = [];
  let catalogContext = null;
  const assets = {
    "/assets/xterm/xterm.css": join(xterm.xtermDir, "css", "xterm.css"),
    "/assets/xterm/xterm.mjs": join(xterm.xtermDir, "lib", "xterm.mjs"),
    "/assets/xterm/addon-fit.mjs": join(xterm.fitDir, "lib", "addon-fit.mjs"),
    "/assets/xterm/addon-unicode11.mjs": unicode11.asset,
  };
  const rawBuffers = new Map();

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
            "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/javascript",
          });
          res.end(data);
        },
        () => res.writeHead(404).end(),
      );
      return;
    }
    if (url.pathname.startsWith("/raw/")) {
      const id = url.pathname.slice("/raw/".length);
      const buffer = rawBuffers.get(id);
      if (buffer) {
        res.writeHead(200, { "content-type": "application/octet-stream" });
        res.end(buffer);
      } else {
        res.writeHead(404).end();
      }
      return;
    }
    if (catalogContext && req.method === "GET" && url.pathname === "/v1/models") {
      catalogContext.handle(res);
      return;
    }
    fixtureHandler(req, res, fixtureLog).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  let browser = null;
  const summary = {
    generatedAt: new Date().toISOString(),
    harness: "scripts/qa-cli-terminal.mjs + .build/qa-pty-helper.py (real PTY, raw ANSI, xterm.js render)",
    invocation: process.argv.join(" "),
    cli: { path: args.cli, sha256: cliSha },
    suite: args.suite,
    live: args.live,
    cols: args.cols,
    themes: args.themes,
    deps: {
      node: process.version,
      python3: spawnSync("python3", ["--version"], { encoding: "utf8" }).stdout.trim(),
      xterm: xterm.source,
      xtermFetched: xterm.fetched,
      unicode11,
      renderer: { htmlSha256: createHash("sha256").update(RENDER_HTML).digest("hex"), textSpacingTrim: "space-all", fontFamily: "monospace" },
      chrome: args.chrome,
      playwright: "workspace node_modules/playwright",
    },
    fixture: {
      baseUrl,
      liveRequests: args.live ? "allowed by --live" : "none expected outside 127.0.0.1 fixture",
      requests: fixtureLog,
    },
    runs: [],
    totals: { pass: 0, fail: 0, skip: 0 },
  };

  const ctx = { cli: args.cli, wsDir, forgeHome, port };
  try {
    if (args.suite === "v2") await v2Context({ root: ROOT, forgeHome, wsDir });
    // Configure fixture through the normal `forge config set` command surface.
    const configArgs = [
      args.cli,
      "config",
      "set",
      "--base-url",
      baseUrl,
      "--model",
      "qa-fixture-model",
      "--api-mode",
      "chat-completions",
      "--api-key-stdin",
    ];
    const config = spawnSync(process.execPath, configArgs, {
      cwd: wsDir,
      input: "qa-fixture-key-not-a-real-value",
      encoding: "utf8",
      env: baseEnv({ FORGE_HOME: forgeHome, HOME: tmpRoot }),
      timeout: 30000,
    });
    const configEvidence = {
      argv: configArgs,
      status: config.status,
      stdout: (config.stdout || "").slice(0, 2000),
      stderr: (config.stderr || "").slice(0, 2000),
    };
    await writeFile(
      join(evidenceDir, "fixture-config.json"),
      JSON.stringify(configEvidence, null, 2),
    );
    if (config.status !== 0) {
      throw new Error("fixture config failed; see fixture-config.json");
    }

    browser = await chromium.launch({
      executablePath: args.chrome,
      args: ["--no-sandbox", "--force-color-profile=srgb", "--disable-lcd-text"],
    });
    const page = await browser.newPage({ deviceScaleFactor: 2 });

    for (const [scenarioName, colSpec] of SUITES[args.suite]) {
      if (args.scenario && args.scenario !== scenarioName) continue;
      if (args.coreOnly && scenarioName in extendedScenarios) continue;
      const scenario = SCENARIOS[scenarioName];
      const widths = colSpec === "all" ? args.cols : colSpec;
      for (const cols of widths) {
      for (const captureTheme of args.suite === 'v2' ? args.themes : [null]) {
        const captureArgs = captureTheme ? { ...args, themes: [captureTheme] } : args;
        const captureScenario = captureTheme ? { ...scenario, env: { ...scenario.env, COLORFGBG: captureTheme === 'light' ? '0;15' : '15;0' } } : scenario;
        const runId = `${scenarioName}-${cols}col${captureTheme ? '-' + captureTheme : ''}`;
        const requestStart = fixtureLog.length;
        catalogContext = scenarioName === "v2-model-discovery" ? discoveryFixture(runId, fixtureLog) : null;
        let run;
        try { run = await runScenario({
          args: captureArgs, ctx, scenario: captureScenario, scenarioName, cols, runId,
          evidenceDir, page, rawBuffers, fixtureLog, requestStart,
        });
        } finally { catalogContext?.dispose(); catalogContext = null; }
        summary.runs.push(run);
        for (const check of run.checks) {
          summary.totals[check.status] = (summary.totals[check.status] || 0) + 1;
        }
        const failed = run.checks.filter((c) => c.status === "fail").length;
        console.log(
          `[${runId}] ${failed ? `FAIL(${failed})` : "PASS"} — ` +
            run.checks.map((c) => `${c.id}:${c.status}`).join(" "),
        );
      }
    }

    }
    if (args.codex) {
      summary.runs.push(
        await runCodexReference({ args, evidenceDir, page, rawBuffers, tmpRoot }),
      );
    }

    summary.fixture.requests = fixtureLog;
  } finally {
    await writeFile(
      join(evidenceDir, "summary.json"),
      JSON.stringify(summary, null, 2),
    ).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
    if (!args.keep) {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  const { pass, fail, skip } = summary.totals;
  console.log(
    `\nsummary: ${pass} pass, ${fail} fail, ${skip} skip — ${join(evidenceDir, "summary.json")}`,
  );
  if (args.keep) console.log(`kept temp dir: ${tmpRoot}`);
  process.exit(fail > 0 && !args.soft ? 1 : 0);
}

function baseEnv(extra = {}) {
  // Exact minimal env; never inherits host credentials or private config.
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: extra.HOME || tmpdir(),
    LANG: "C.UTF-8",
    TERM: "xterm-256color",
    ...extra,
  };
}

async function runScenario({ args, ctx, scenario, scenarioName, cols, runId, evidenceDir, page, rawBuffers, fixtureLog, requestStart }) {
  const rows = scenario.rows || 30;
  const rawPath = join(evidenceDir, `${runId}.raw`);
  const eventsPath = join(evidenceDir, `${runId}.events.jsonl`);
  const scenarioPath = join(evidenceDir, `${runId}.scenario.json`);

  if (scenarioName === 'v2-resume') await v2Context({ root: ROOT, forgeHome: ctx.forgeHome, wsDir: ctx.wsDir });
  if (scenarioName === 'v2-approval') await writeFile(join(ctx.wsDir, 'qa-approval-counter'), '');
  const scenarioJson = {
    cmd: cliCmd(ctx),
    env: {
      ...baseEnv({ FORGE_HOME: ctx.forgeHome, HOME: dirname(ctx.forgeHome) }),
      ...(scenario.env || {}),
    },
    cwd: ctx.wsDir,
    steps: scenario.steps(),
  };
  await writeFile(scenarioPath, JSON.stringify(scenarioJson, null, 2));

  const helper = spawn(
    "python3",
    [
      join(ROOT, ".build", "qa-pty-helper.py"),
      "--cols", String(cols),
      "--rows", String(rows),
      "--raw", rawPath,
      "--events", eventsPath,
      "--scenario", scenarioPath,
      "--timeout-ms", "300000",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let helperErr = "";
  helper.stderr.on("data", (d) => {
    helperErr += d.toString();
  });
  const helperCode = await new Promise((r) => helper.on("exit", r));

  const raw = await readFile(rawPath).catch(() => Buffer.alloc(0));
  const events = String(await readFile(eventsPath).catch(() => ""))
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
  const exitEvent = [...events].reverse().find((e) => e.type === "exit") || {
    done: false,
    code: null,
    signal: null,
  };

  rawBuffers.set(runId, raw);

  // Replay raw ANSI into xterm.js; screenshot each mark in both themes.
  const marks = events.filter((e) => e.type === "mark");
  const markNames = marks.map((m) => m.name);
  const screens = {};
  const states = {};
  const screenshots = [];
  for (const theme of args.themes) {
    await page.goto(`http://127.0.0.1:${ctx.port}/render`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__qaReady === true);
    let fed = 0;
    let curCols = cols;
    let curRows = rows;
    await page.evaluate(
      ([c, r, t]) => window.__qa.init(c, r, t),
      [curCols, curRows, theme],
    );
    let markOrdinal = 0;
    const streamEvents = events.filter((e) => e.type === "mark" || e.type === "resize");
    for (const ev of streamEvents) {
      const offset = ev.offset ?? raw.length;
      await feedTo(page, raw, fed, offset);
      fed = Math.max(fed, offset);
      if (ev.type === "resize") {
        curCols = ev.cols;
        curRows = ev.rows;
        await page.evaluate(([c, r]) => window.__qa.resize(c, r), [curCols, curRows]);
        continue;
      }
      const state = await page.evaluate(() => window.__qa.state());
      if (theme === args.themes[0]) {
        screens[ev.name] = state.text;
        states[ev.name] = state;
      }
      const ordinal = ++markOrdinal;
      const name = `${runId}--mark-${String(ordinal).padStart(3, "0")}--${ev.name}--${state.cols}x${state.rows}--${theme}.png`;
      const box = await page.locator("#host").boundingBox();
      await page.setViewportSize({
        width: Math.ceil(box.width) + 24,
        height: Math.ceil(box.height) + 24,
      });
      await page.locator("#host").screenshot({ path: join(evidenceDir, name) });
      screenshots.push({
        mark: ev.name,
        ordinal,
        theme,
        cols: state.cols,
        rows: state.rows,
        cursor: state.cursor,
        file: name,
      });
    }
    // capture the terminal's full final state as screen text for the summary
    if (theme === args.themes[0]) {
      const state = await page.evaluate(() => window.__qa.state());
      screens.__final = state.text;
      states.__final = state;
    }
  }

  const rawText = raw.toString("utf8");
  const counterText = await readFile(join(ctx.wsDir, "qa-approval-counter"), "utf8").catch(() => "");
  const persistedSession = scenarioName === 'v2-resume' ? JSON.parse(await readFile(join(ctx.forgeHome, 'sessions', '22222222-2222-4222-8222-222222222222.json'), 'utf8')) : null;
  const sessionSnapshots = scenarioName === 'v2-picker-cancel' ? await Promise.all((await readdir(join(ctx.forgeHome, 'sessions'))).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(ctx.forgeHome, 'sessions', name), 'utf8')))) : [];
  const checks = scenario.checks.map((id) => {
    let result;
    try {
      if (id in v2Checks) result = v2Checks[id]({ screens, states, screenshots, rawText, requests: fixtureLog.slice(requestStart), ctx, exitEvent, counterText, events, persistedSession, sessionSnapshots });
       else {
      const marks = { startup_compact: "startup", startup_rendered: "startup", help_lists_commands: "help", picker_set_model: "model-set" };
      result = CHECKS[id](marks[id] ? screens[marks[id]] : screens, rawText, exitEvent);
       }
    } catch (error) {
      result = { status: "fail", observed: `check error: ${error.message}` };
    }
    return { id, ...result };
  });
  const expectedMarks = scenarioJson.steps.filter(s => s.action === "mark").map(s => s.name);
  const issues = [];
  if (helperCode !== 0) issues.push(`helper exit ${helperCode}`);
  const allowed = scenarioName === "ctrl-c" ? [0, 130] : [0];
  if (!exitEvent.done || exitEvent.signal != null || !allowed.includes(exitEvent.code)) issues.push(`child exit code=${exitEvent.code} signal=${exitEvent.signal}`);
  for (const e of events) {
    if (["timeout", "killed", "bad_step", "skipped_step"].includes(e.type)) issues.push(e.type);
    if (e.type === "wait_for" && !e.matched || e.type === "wait_quiet" && !e.quiet || e.type === "wait_exit" && !e.done || e.type === 'assert_file' && !e.matched) issues.push(`unsuccessful ${e.type}:${e.name || ""}`);
  }
  for (const mark of expectedMarks) {
    if (!marks.some(m => m.name === mark && m.offset > 0) || !screens[mark]?.trim()) issues.push(`missing/empty mark ${mark}`);
    for (const theme of args.themes) {
      const shot = screenshots.find(s => s.mark === mark && s.theme === theme);
      const bytes = shot ? await readFile(join(evidenceDir, shot.file)).catch(() => null) : null;
      if (!bytes || bytes.length < 100 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) issues.push(`missing/invalid PNG ${mark}:${theme}`);
    }
  }
  if (!raw.length || !events.length || !args.themes.length) issues.push("empty capture");
  checks.unshift({ id: "run_integrity", status: issues.length ? "fail" : "pass", observed: issues.length ? issues.join("; ") : `helper/child successful; ${expectedMarks.length} marks captured; all waits successful` });
  // Real observation sanity: a check must have observed something.
  for (const check of checks) {
    if (check.observed == null || (typeof check.observed === "string" && !check.observed.length)) {
      check.status = "fail";
      check.observed = "no observation recorded";
    }
  }

  return {
    id: runId,
    scenario: scenarioName,
    describe: scenario.describe,
    cols,
    rows,
    helperExitCode: helperCode,
    helperStderr: helperErr.slice(0, 1000),
    exit: exitEvent,
    marks: markNames,
    rawBytes: raw.length,
    fixtureMarkers: {
      fixtureReply: rawText.includes(FIXTURE_TEXT_REPLY),
      streamOk: rawText.includes(FIXTURE_STREAM_OK),
      toolSeen: rawText.includes(TOOL_RESULT_SEEN),
      toolMissing: rawText.includes(TOOL_RESULT_MISSING),
      slowTail: rawText.includes(FIXTURE_SLOW_TAIL),
      approveDone: rawText.includes(APPROVE_DONE),
    },
    screenshots,
    states,
    checks,
    requestEvidence: fixtureLog.slice(requestStart),
    artifacts: {
      raw: `${runId}.raw`,
      events: `${runId}.events.jsonl`,
      scenario: `${runId}.scenario.json`,
    },
  };
}

async function feedTo(page, raw, from, to) {
  const slice = raw.subarray(from, to);
  const CHUNK = 24 * 1024;
  for (let i = 0; i < slice.length; i += CHUNK) {
    const chunk = slice.subarray(i, i + CHUNK);
    await page.evaluate((data) => window.__qa.feed(data), b64(chunk));
  }
}

async function runCodexReference({ args, evidenceDir, page, rawBuffers, tmpRoot }) {
  // Design reference only: initial view of `codex --no-alt-screen`, no prompt,
  // no tool activity, isolated HOME/CODEX_HOME so no config is read or written.
  const rawPath = join(evidenceDir, "codex-reference.raw");
  const eventsPath = join(evidenceDir, "codex-reference.events.jsonl");
  const scenarioPath = join(evidenceDir, "codex-reference.scenario.json");
  const codexHome = join(tmpRoot, "codex-home");
  await mkdir(codexHome, { recursive: true });
  const scenarioJson = {
    cmd: ["/usr/bin/codex", "--no-alt-screen"],
    env: baseEnv({ HOME: join(tmpRoot, "codex-home-user"), CODEX_HOME: codexHome }),
    cwd: tmpRoot,
    steps: [
      { action: "wait_quiet", ms: 1500, timeout_ms: 10000, name: "codex-quiet" },
      { action: "mark", name: "codex-initial" },
    ],
  };
  await writeFile(scenarioPath, JSON.stringify(scenarioJson, null, 2));
  const helper = spawn("python3", [
    join(ROOT, ".build", "qa-pty-helper.py"),
    "--cols", "120", "--rows", "30",
    "--raw", rawPath, "--events", eventsPath, "--scenario", scenarioPath,
    "--timeout-ms", "30000",
  ]);
  await new Promise((r) => helper.on("exit", r));
  const raw = await readFile(rawPath).catch(() => Buffer.alloc(0));
  const events = String(await readFile(eventsPath).catch(() => ""))
    .split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  rawBuffers.set("codex-reference", raw);
  const screenshots = [];
  for (const theme of args.themes) {
    await page.goto(`http://127.0.0.1:${new URL(`http://x`).port ?? ""}/render`.replace("//x", `//127.0.0.1`), {
      waitUntil: "load",
    }).catch(() => {});
    // (goto rewritten below with real port via page context)
  }
  // Render with the real server port passed through page's current origin is
  // unreliable; caller page already knows the port from previous runs.
  const port = new URL(page.url() || "http://127.0.0.1").port;
  for (const theme of args.themes) {
    await page.goto(`http://127.0.0.1:${port}/render`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__qaReady === true);
    await page.evaluate(() => window.__qa.init(120, 30, theme));
    let fed = 0;
    for (const ev of events.filter((e) => e.type === "mark" || e.type === "resize")) {
      await feedTo(page, raw, fed, ev.offset ?? raw.length);
      fed = ev.offset ?? raw.length;
      const name = `codex-reference--mark-${String(screenshots.length + 1).padStart(3, "0")}--${ev.name}--120x30--${theme}.png`;
      const box = await page.locator("#host").boundingBox();
      await page.setViewportSize({
        width: Math.ceil(box.width) + 24,
        height: Math.ceil(box.height) + 24,
      });
      await page.locator("#host").screenshot({ path: join(evidenceDir, name) });
      screenshots.push({ mark: ev.name, theme, file: name });
    }
  }
  return {
    id: "codex-reference",
    scenario: "codex-reference",
    describe: "design reference only — codex --no-alt-screen initial view, no prompt submitted",
    checks: [],
    screenshots,
    rawBytes: raw.length,
    artifacts: { raw: "codex-reference.raw", events: "codex-reference.events.jsonl", scenario: "codex-reference.scenario.json" },
  };
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exit(2);
});
