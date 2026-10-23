import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer, isIP } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

export async function connectHost(origin) {
  const post = async (path, body, clientId) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...(clientId ? { "X-Forge-Client": clientId } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Host inspection failed (${response.status}); no task request was retried.`);
    return response.json();
  };
  const { clientId } = await post("/api/connect", {});
  return async () => {
    const reply = await post("/api/rpc", { id: crypto.randomUUID(), method: "getHostState" }, clientId);
    if (!reply.ok || !reply.result?.hostId || !Array.isArray(reply.result.runs)) throw new Error("Invalid host state; refusing to stop anything.");
    return reply.result;
  };
}

// An older all-in-one server has no drain RPC. Require a quiet window, never
// cancel runs, and fail closed on unreadable state or replacement host identity.
export async function waitForIdle(read, { wait = false, timeoutMs = 1800000, intervalMs = 2000, quietMs = 10000, sleep = delay, now = Date.now, log = console.log } = {}) {
  const started = now();
  let identity;
  let quietSince;
  let lastCount;
  for (;;) {
    const state = await read();
    identity ??= state.hostId;
    if (state.hostId !== identity) throw new Error("Old host identity changed; inspect service state before trying again.");
    if (lastCount !== state.runs.length) log(`Old Core active runs: ${state.runs.length}`);
    lastCount = state.runs.length;
    if (state.runs.length === 0) {
      quietSince ??= now();
      if (now() - quietSince >= quietMs) return state;
    } else {
      quietSince = undefined;
      if (!wait) throw new Error("Active conversations remain. Nothing was stopped. Use --wait during a quiet maintenance window.");
    }
    if (now() - started >= timeoutMs) throw new Error("Timed out waiting for idle; old service was not stopped.");
    await sleep(intervalMs);
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    host: { type: "string" }, port: { type: "string", default: "5174" }, "core-port": { type: "string", default: "5175" },
    "old-unit": { type: "string", default: "forge-web-dev-lan.service" },
    workspace: { type: "string", default: root }, "state-dir": { type: "string", default: join(homedir(), ".local/share/forge") },
    apply: { type: "boolean" }, wait: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Switch old local Web service to separate forge-core.service / forge-web.service.\n--host <existing IPv4> [--port 5174] [--core-port 5175] [--old-unit forge-web-dev-lan.service] [--workspace directory] [--state-dir existing FORGE_HOME] [--apply] [--wait]\nWithout --apply only inspect. --wait waits up to 30 minutes and requires a 10-second quiet window; do not submit new tasks during initial migration. No providers/configuration files are read by this script.");
    return;
  }
  if (!values.host || isIP(values.host) !== 4 || values.host === "0.0.0.0") throw new Error("Supply the existing service's specific IPv4 --host.");
  for (const port of [values.port, values["core-port"]]) if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Ports must be between 1024 and 65535.");
  if (values.port === values["core-port"]) throw new Error("Core and Web must use different ports.");
  const oldUnit = values["old-unit"];
  if (!/^[\w.-]+\.service$/.test(oldUnit) || ["forge-core.service", "forge-web.service"].includes(oldUnit)) throw new Error("Expected the old all-in-one service unit, not the new Core/Web units.");
  const env = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid()}` };
  env.DBUS_SESSION_BUS_ADDRESS ??= `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
  const command = async (program, args) => (await execute(program, args, { env, timeout: 30000, maxBuffer: 64 * 1024 })).stdout.trim();
  const property = (unit, name) => command("systemctl", ["--user", "show", unit, `--property=${name}`, "--value"]);
  const oldPid = await property(oldUnit, "MainPID");
  if (oldPid === "0" || await property(oldUnit, "ActiveState") !== "active") throw new Error("Old service is not active; no effects performed. Inspect manually.");
  const start = await property(oldUnit, "ExecStart");
  if (!start.includes("scripts/dev-web.mjs")) throw new Error("Unrecognized old launcher. Refusing to replace an unknown service.");
  const origin = `http://${values.host}:${values.port}`;
  const coreOrigin = `http://127.0.0.1:${values["core-port"]}`;
  const readOld = await connectHost(origin);
  const initial = await readOld();
  console.log(JSON.stringify({ oldUnit, oldPid: Number(oldPid), activeRuns: initial.runs.length, web: origin, core: coreOrigin, workspace: resolve(values.workspace), stateDir: resolve(values["state-dir"]), apply: values.apply === true }));
  if (!values.apply) return;
  for (const unit of ["forge-core.service", "forge-web.service"]) {
    if (await property(unit, "LoadState") !== "not-found") throw new Error(`${unit} already exists; no replacement or automatic replay performed.`);
  }
  await Promise.all([
    access(join(root, "repos/forge-core/dist/web/serve.js")),
    access(join(root, "repos/forge-web-ui/scripts/dev.mjs")),
  ]);
  await waitForIdle(readOld, { wait: values.wait });
  // Detect a port collision before taking down the only running service.
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(Number(values["core-port"]), "127.0.0.1", done);
  });
  await new Promise(done => probe.close(done));
  for (const unit of ["forge-core.service", "forge-web.service"]) {
    if (await property(unit, "LoadState") !== "not-found") throw new Error(`${unit} appeared during the wait; nothing was stopped.`);
  }
  if (await property(oldUnit, "MainPID") !== oldPid || (await readOld()).runs.length !== 0) throw new Error("Old service changed or became busy; nothing was stopped.");
  console.log("Quiet window confirmed. Stopping old all-in-one Web once; starting independent services.");
  await command("systemctl", ["--user", "stop", oldUnit]);
  // No PartOf/BindsTo relationship: restarting/stopping Web cannot stop Core.
  await command("systemd-run", ["--user", "--unit=forge-core.service", "--description=Forge independent Core", `--working-directory=${root}`, "--property=Restart=on-failure", "--property=RestartSec=3", `--setenv=FORGE_HOME=${resolve(values["state-dir"])}`, process.execPath, join(root, "repos/forge-core/dist/web/serve.js"), "--host", "127.0.0.1", "--port", values["core-port"], "--workspace", resolve(values.workspace), "--multi-workspace"]);
  const ready = async (address) => {
    for (let attempt = 0; ; attempt++) {
      try { const read = await connectHost(address); return { read, state: await read() }; }
      catch (error) { if (attempt >= 20) throw error; await delay(500); }
    }
  };
  const core = await ready(coreOrigin);
  await command("systemd-run", ["--user", "--unit=forge-web.service", "--description=Forge Web UI Vite HMR (Core independent)", `--working-directory=${root}`, "--property=Restart=on-failure", "--property=RestartSec=3", process.execPath, join(root, "repos/forge-web-ui/scripts/dev.mjs"), "--host", values.host, "--port", values.port, "--core-url", coreOrigin]);
  const web = await ready(origin);
  if (web.state.hostId !== core.state.hostId) throw new Error("Gateway did not connect to the expected Core.");
  const corePid = await property("forge-core.service", "MainPID");
  await command("systemctl", ["--user", "restart", "forge-web.service"]);
  const restarted = await ready(origin);
  if (restarted.state.hostId !== core.state.hostId || await property("forge-core.service", "MainPID") !== corePid) throw new Error("Core identity changed across Web restart.");
  console.log(`Split migration complete: ${origin}; Core PID ${corePid} and host identity stayed unchanged across Web restart. Restart only: systemctl --user restart forge-web.service`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
