# Local MCP servers

Forge implements real stdio MCP using newline JSON-RPC and revision
`2025-11-25`. Unsupported negotiated revisions fail closed. Remote HTTP,
SSE and OAuth are not implemented.

## Register and use the example

From a TypeScript host integrating Forge:

```ts
import { resolve } from "node:path";
import { createMcpService } from "../src/mcp/registry";

const service = await createMcpService({ home: "/your/private/forge-home" });
try {
  await service.register({
    id: "echo", label: "Local echo", command: process.execPath,
    args: [resolve("examples/mcp/echo-server.mjs")], enabled: true,
  });
  console.log(await service.listTools("echo"));
  console.log(await service.callTool("echo", "echo", { text: "hello" }));
} finally {
  await service.dispose();
}
```

The example executable also runs directly with
`node examples/mcp/echo-server.mjs`; stdin/stdout are protocol channels, not
an interactive shell. Register only executables you trust. Registration and
enabling alone do not launch a server. Discovery, calls, and **a user-requested
health probe of an enabled server** can launch it.

The native registry exposes `mcp_list_tools {server}` and
`mcp_call_tool {toolName, arguments_json?}`. Encode the discovered tool's input
object as JSON text, for example `{"toolName":"mcp__echo__echo","arguments_json":"{\"text\":\"hello\"}"}`.
Omitting `arguments_json` sends `{}`. JSON text prevents gateways from rewriting
arbitrary nested input fields. Existing object-valued `arguments` calls still
work; supplying both representations is rejected before approval or execution.
Use the alias returned by discovery;
long or transformed names are hashed and mapped back to their exact remote
name. Readonly denies both tools. Workspace requires fresh approval for each
operation; unrestricted allows explicitly registered enabled servers.
Server annotations never authorize an operation. This is not an OS sandbox.

## Configuration and safety

Configuration is private at `<FORGE_HOME>/mcp/servers.json`, not in project
AGENTS or skills. `envNames` maps child variable names to approved host names;
`env` contains private literal values. Minimal inheritance is PATH/TMPDIR
(and SYSTEMROOT on Windows). Credential-looking host mappings, development
key names and loader-injection variables are rejected. Do not put credentials
in command arguments or labels.

Private values and resolved mapped values are redacted from discovered
metadata/schema, call text and remote errors. Runtime `redactValues` may be
passed to both listTools and callTool (or the native registry). Redaction is
literal and cannot stop an intentionally malicious server encoding secrets.
Server logs are not forwarded. Health returns sanitized connection failures.

Each effect revalidates the authoritative catalog; mutations use a
cross-process lock. Disable/remove closes the catalog instance's connection;
other instances detect revocation before their next effect. Foundation can
use `revoke(id)` to actively close same-process run instances immediately.

AbortSignal reaches startup, initialize, discovery and calls. Pre-aborted
work neither launches nor writes. Abort, timeout and malformed transport
responses settle pending work and close the process group. Uncertain calls
are never automatically replayed. On Linux, awaited close/revoke/dispose retains referenced cleanup work: SIGTERM,
up to two seconds of grace, then SIGKILL, with a three-second termination
budget. Live group members are identified using /proc PID/start-time pairs;
no delayed signal is sent once the owned group has disappeared. Zombies are
terminated, not live workers. Cleanup failure rejects close/revoke/dispose.
Other platforms only clean up the direct child; Windows and other non-Linux
process trees are explicitly unsupported/unverified.

Limits: 1 MiB messages, 32 pending requests, 32 servers, 16 discovery pages,
256 tools/server, 64 KiB UTF-8 native call arguments, 64 KiB UTF-8 returned
text after redaction. Truncation preserves code points, appends a visible
marker and returns truncated:true and isError:true. Native call JSON
envelopes also fit 64 KiB without slicing serialized JSON. Discovery has a
256 KiB aggregate UTF-8 budget for incoming page results, stored sanitized
metadata and returned native JSON, independently enforced. Exceeding any
budget raises invalid_input; no partial tools or broken schemas are returned.
Alias storage replaces each server’s old discovery and is capped at 8192 entries. Only
text tool results are supported. Object input schemas are surfaced after
redaction; full JSON Schema argument validation is delegated to the server.

## Development-only checks (source checkout)

These commands exist **only in a source checkout**; they are not part of the installed payload and
require the repository's `tests/` and `node_modules/`:

```
./node_modules/.bin/vitest run tests/mcp
./node_modules/.bin/biome check src/mcp src/tools/mcp.ts tests/mcp examples/mcp
./node_modules/.bin/tsc --noEmit
```

Tests use real local child processes and temporary directories; no API keys
or remote services are needed.
