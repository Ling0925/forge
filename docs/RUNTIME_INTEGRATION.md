# Runtime integration: browser tools and provider cache usage

## Browser tool settings

Two optional, nonsecret preferences live on `PublicSettings` and `ConfigureInput.settings`:

| Field | Type | Default | Validation |
| --- | --- | --- | --- |
| `browserAllowedOrigins` | `readonly string[]` | `[]` (browser tools disabled) | 0–32 exact canonical HTTP(S) origins. Each entry must equal its own `new URL(value).origin`: scheme `http`/`https`, host, optional port. No wildcards, no userinfo, no path, query or fragment. |
| `browserExecutablePath` | `string` | `""` (Playwright default / `FORGE_BROWSER_EXECUTABLE`) | ≤ 4096 chars, no line breaks. |

Existing saved configuration remains valid: missing fields are filled with the
disabled defaults, and `ProviderConfig` still carries only
`baseUrl`/`apiKey`/`requestTimeoutMs`.

### CLI examples

```sh
# Enable browser tools for one exact local origin:
forge config set --browser-origins http://127.0.0.1:4173

# Multiple exact origins (comma-separated):
forge config set --browser-origins http://127.0.0.1:4173,https://example.invalid

# Disable browser tools again (empty clears the list):
forge config set --browser-origins ""

# Pin a Chromium/Chrome executable:
forge config set --browser-executable /usr/bin/chromium

# Return to the Playwright default / FORGE_BROWSER_EXECUTABLE:
forge config set --browser-executable ""
```

Invalid values (wildcards like `https://*`, `https://*.example.invalid`,
credentials, paths, queries, fragments, non-HTTP(S) schemes, more than 32
origins) are rejected with a generic validation message that never echoes the
input value.

### Harness behavior

The default per-run tool factory always creates the local tool registry with
the configured API key added to redaction. When `browserAllowedOrigins` is
nonempty it additionally creates the browser registry (`allowedOrigins`,
optional `executablePath`, `headless: true`, same key redaction) and combines
both registries. The browser module is loaded lazily at the source level, so
Chromium never launches until a browser tool is actually called. Note that the
built CLI bundles this dynamic import, so `dist/cli.mjs` requires the
Playwright JavaScript package (shipped in the release) even for local-only
runs; only the browser executable stays optional and lazily launched. If
registry construction fails partway, already-created registries are disposed.
A custom injected `toolFactory` keeps its exact behavior and bypasses browser
composition. Every run disposes its tool registry, and `dispose()` settles
in-flight runs. No browser default ever permits arbitrary remote origins.

### Renderer / UI worker handoff

`browserAllowedOrigins` (list editor; each item validated as an exact canonical origin) and
`browserExecutablePath` (path input; empty clears) are plain settings controls over the existing
`getSettings`/`updateSettings` channel; the workbench Settings view already renders them (see
`src/renderer/components/workbench/Settings.tsx`). Both fields live on `PublicSettings`; no extra
IPC methods are involved. The provider API key is never requested or displayed.

## Real provider-cache usage

`Usage` gains an optional `cachedPromptTokens`. The provider normalizes
`usage.prompt_tokens_details.cached_tokens` (preferred) or a compatible
top-level `usage.cached_tokens` when the gateway reports it. Zero is a known
value and is preserved; absence stays absent and is never invented. The runtime
aggregates reported cache counts across turns and the count appears on
`run_finished` usage only when the gateway actually reported it. There is no
local answer-replay cache for effectful agent tasks; the byte-stable
instruction/history prefix plus the local file-read cache remain the existing
caching surfaces. No extra request fields are sent to the provider.
