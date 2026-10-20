# MCP servers

Forge implements real MCP using JSON-RPC 2.0. It advertises revision
`2025-11-25` and accepts any published revision a server negotiates
(`2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`), which keeps legacy
SSE servers usable. Arbitrary/unknown negotiated versions fail closed. Three
transports are supported through the same `McpService` interface:

| transport | direction | notes |
| --- | --- | --- |
| `stdio` | local child process | default; the historical behavior |
| `http` | Streamable HTTP | opt-in; one POST endpoint per message |
| `sse` | legacy HTTP+SSE | opt-in; one GET event stream plus a negotiated POST endpoint |

OAuth is **not** implemented. Remote servers are authenticated with optional
private headers only.

## Register and use the stdio example

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

## Register a remote server

Remote registration is opt-in and requires an explicit `transport` (`http` or
`sse`) and an absolute, credential-free `http(s)` URL:

```ts
await service.register({
  id: "remote",
  label: "Remote tools",
  transport: "http",           // or "sse"
  url: "https://example.test/mcp",
  headers: { Authorization: "Bearer …" }, // optional private headers
  enabled: true,
});
```

- Registering a remote server is **side-effect free**; no request is made to
  the endpoint until an effectful operation runs.
- A `disabled` server is **never connected**. Enable it explicitly first.
- Explicit user registration authorizes exactly that origin, including a local
  loopback fixture endpoint. Redirects are refused, and a legacy SSE server may
  only negotiate a **same-origin** POST endpoint.
- Remote credentials live only in optional private headers in
  `<FORGE_HOME>/mcp/servers.json` (owner-only). Public `McpServerRecord` values
  expose only `hasPrivateHeaders`/`headerCount` and the credential-free URL —
  never header names or values.

Endpoint, header, body/frame, timeout, cancellation, session-id and redirect
handling:

- URLs must be absolute `http`/`https`, with no userinfo, fragment or control
  characters.
- Header names must be valid HTTP tokens and may not override transport-managed
  headers (`host`, `content-length`, `content-type`, `accept`, `connection`,
  `mcp-session-id`, `mcp-protocol-version`, proxy and hop-by-hop headers).
  Values are bounded and reject CR/LF/NUL injection. At most 32 headers.
- `Mcp-Session-Id` responses are validated (bounded, no control characters) and
  echoed on later requests. Session termination via `DELETE` is optional in MCP
  and is not sent; `close()` aborts and joins every owned request instead, so no
  network request is left hanging.
- Every network send is bounded by the configured request timeout, including
  notifications such as `notifications/initialized`. A stalled server therefore
  cannot hang connect; the send is aborted and the failure is surfaced.
- Streamable HTTP POST responses may be `application/json` (one message) or
  `text/event-stream` (events routed by JSON-RPC id). Only actual outgoing
  requests (numeric `id` plus `method`) await a response body; a client reply to
  a server-triggered request is a notification-like POST and is never awaited.
  Other content types, empty bodies, malformed JSON, invalid frames and
  oversized bodies terminate the connection.
- Legacy SSE uses a GET `text/event-stream`; the server's `endpoint` event must
  stay on the registered origin. The entire stream negotiation (including
  receiving response headers) is bounded; on timeout the owned GET is aborted.
  If the ready stream later ends, pending calls settle immediately.
- Server-triggered requests (sampling, elicitation, roots, any custom method)
  are answered with JSON-RPC `-32601` and are never executed; no local command
  runs in response to a remote server.
- Abort and timeout settle every pending request, abort in-flight `fetch` calls
  and close the event stream. Uncertain operations are never retried and there
  is no automatic transport fallback.

## Native tools

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
AGENTS or skills. For stdio servers, `envNames` maps child variable names to
approved host names and `env` contains private literal values. Minimal
inheritance is PATH/TMPDIR (and SYSTEMROOT on Windows). Credential-looking host
mappings, development key names and loader-injection variables are rejected. Do
not put credentials in command arguments or labels.

Private stdio values, resolved mapped values and remote header values are
redacted from discovered metadata/schema, call text and remote errors. Runtime
`redactValues` may be passed to both listTools and callTool (or the native
registry). Redaction is literal and cannot stop an intentionally malicious
server encoding secrets. Server logs are not forwarded. Health returns
sanitized connection failures; remote transport messages never include
response bodies, header values or the raw URL query.

Each effect revalidates the authoritative catalog; mutations use a
cross-process lock. Disable/remove closes the catalog instance's live
connection; other instances detect revocation before their next effect.
Foundation can use `revoke(id)` to actively close same-process run connections
immediately, terminating pending remote requests and streams.

AbortSignal reaches startup, initialize, discovery and calls. Pre-aborted work
neither launches a process nor sends a request. Abort, timeout and malformed
transport responses settle pending work and close the process/stream.
Uncertain calls are never automatically replayed.

On Linux, awaited stdio close/revoke/dispose retains referenced cleanup work:
SIGTERM, up to two seconds of grace, then SIGKILL, with a three-second
termination budget. Live group members are identified using /proc PID/start-time
pairs; no delayed signal is sent once the owned group has disappeared. Zombies
are terminated, not live workers. Cleanup failure rejects close/revoke/dispose.
Other platforms only clean up the direct child; Windows and other non-Linux
process trees are explicitly unsupported/unverified. Remote connections abort
their `fetch` controllers and stream readers instead.

Limits: 1 MiB messages/bodies, 4 MiB buffered SSE data, 32 pending requests, 32
servers, 16 discovery pages, 256 tools/server, 64 KiB UTF-8 native call
arguments, 64 KiB UTF-8 returned text after redaction. Truncation preserves code
points, appends a visible marker and returns truncated:true and isError:true.
Native call JSON envelopes also fit 64 KiB without slicing serialized JSON.
Discovery has a 256 KiB aggregate UTF-8 budget for incoming page results, stored
sanitized metadata and returned native JSON, independently enforced. Exceeding
any budget raises invalid_input; no partial tools or broken schemas are returned.
Alias storage replaces each server’s old discovery and is capped at 8192 entries.
Only text tool results are supported. Object input schemas are surfaced after
redaction; full JSON Schema argument validation is delegated to the server.

## CLI and Web registration

```sh
forge mcp register local "Local server" node /path/to/server.mjs
forge mcp register-remote remote "Remote server" https://example.com/mcp
forge mcp register-remote legacy "Legacy SSE" https://example.com/sse --transport sse
forge mcp register-remote private "Authenticated" https://example.com/mcp --headers-file /path/to/headers.json
```

`headers.json` is an object such as `{"Authorization":"Bearer YOUR_TOKEN"}`.
The CLI defaults remote transport to HTTP and registration to enabled; add
`--disabled` to save without enabling. Registration does not connect or probe.
The Web MCP panel uses the same registration methods and offers a transport
selector, URL and optional private Authorization input. Existing call permissions
apply; no extra registration approval is added.

## Public DTO contract

`McpServerRecord` and `McpRecordDto` keep every old field
and adds optional remote fields. Stdio records keep `command`/`args` populated;
remote records keep those fields present but empty so old readers do not break.

```ts
type McpServerRecord = {
  id: string;
  label: string;
  command: string;              // "" for remote
  args: readonly string[];      // [] for remote
  enabled: boolean;
  requestTimeoutMs: number;
  envNameCount: number;         // 0 for remote
  hasPrivateEnv: boolean;       // false for remote
  transport?: "stdio" | "http" | "sse"; // additive; stdio records report "stdio"
  url?: string;                 // additive; credential-free, remote only
  headerCount?: number;         // additive; remote only, never names/values
  hasPrivateHeaders?: boolean;  // additive; remote only
};
```

Registration input is a union. Legacy stdio input (no `transport`, or
`transport: "stdio"`) is unchanged. Remote input requires
`transport: "http" | "sse"` and `url`, and accepts optional `headers`,
`enabled`, `requestTimeoutMs`:

```ts
type McpRegisterInput =
  | { id; label; command; args; envNames?; env?; enabled?; requestTimeoutMs?; transport?: "stdio" }
  | { id; label; transport: "http" | "sse"; url; headers?; enabled?; requestTimeoutMs? };
```

`McpHealth` is unchanged except for an additive optional `transport`.

## Development-only checks (source checkout)

These commands exist **only in a source checkout**; they are not part of the installed payload and
require the repository's `tests/` and `node_modules/`:

```
./node_modules/.bin/vitest run tests/mcp
./node_modules/.bin/biome check src/mcp tests/mcp
./node_modules/.bin/tsc --noEmit
```

Tests use real local child processes and real loopback HTTP/SSE servers with
temporary directories; no API keys or remote services are needed.
