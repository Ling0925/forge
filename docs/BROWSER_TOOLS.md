# Forge browser tools

## Integration / exports

- `createBrowserToolRegistry(options: ForgeBrowserOptions): Promise<LocalToolRegistry>` from `src/tools/browser.ts`.
- `ForgeBrowserOptions` extends shared `BrowserToolOptions` with optional `redactValues: readonly string[]`. Pass configured secrets here when constructing tools; never include them in model arguments.
- `createCombinedToolRegistry(...registries): LocalToolRegistry` from `src/tools/combined.ts` validates unique names, dispatches known names, returns recoverable errors for unknown names or calls after disposal, and disposes every registry.

Create **one browser registry per run**, never per persisted session. The default per-run tool factory in `src/core/harness.ts` performs this integration: it always builds the local registry and the MCP tool registry (each with the configured API key added to redaction) and, **only when `settings.browserAllowedOrigins` is nonempty**, lazily imports `src/tools/browser.ts`, creates the browser registry with those exact origins, an optional `executablePath` (from `settings.browserExecutablePath`), `headless: true` and the same key redaction, and combines all of them into one `LocalToolRegistry`. Chromium launches only on first actual browser-tool use, and any partially created registries are disposed if construction fails. A custom injected `toolFactory` bypasses this composition and keeps its own behavior.

```ts
const browser = await createBrowserToolRegistry({
  allowedOrigins: ['http://127.0.0.1:4173'],
  redactValues: knownSecrets,
});
const tools = createCombinedToolRegistry(localTools, browser);
try {
  // Run with tools and the run's ToolContext/AbortSignal.
} finally {
  await tools.dispose();
}
```

Use ordinary installed Playwright Chromium. Defaults use Playwright's bundled executable. `executablePath` takes precedence over the explicit process environment override `FORGE_BROWSER_EXECUTABLE`. No host path is hardcoded. The launched child receives only PATH and optional DISPLAY, not inherited provider credentials. A fresh nonpersistent context has no imported user profile, cookies, permissions or storage. No evaluate tool is exposed.

## Tools and permission scope

Forge's core denies every browser tool in readonly/plan mode before approval.
The standalone registry's readonly behavior below applies only when embedded
directly without that core policy. `browser_read` and `browser_close` accept an
optional `reason` string (up to 512 characters); `{}` remains valid. Declaring
this field avoids incompatible empty-object placeholders added by gateways.

- `browser_navigate`: bounded credential-free HTTP(S) URL, at most 4096 characters. `allowedOrigins` is required: exact canonical parsed origins, no wildcard; `[]` denies all navigation. Local HTTP QA origins are supported. Workspace and readonly emit a typed `approval_requested` event **before** invoking the approval handler. Unrestricted does not prompt. Approval grants that origin for this run, not other configured origins. Subresources on a second configured origin stay blocked until explicitly approved through navigation to it.
- `browser_read`: bounded DOM text extraction inside the browser, at most 12000 characters / 20000 visited text nodes, with truncation metadata. Script/style text is excluded; visibility filtering is best effort, not a full accessibility snapshot. Output is untrusted page data.
- `browser_click`, `browser_fill`: selectors at most 1000 characters; fill text at most 4000. Readonly denies them. Workspace prompts for the origin, selector and action (fill length, not secret input text). Unrestricted executes without a prompt, still under the network policy.
- `browser_screenshot`: absent path returns text-only metadata. Writing requires non-readonly permission; workspace prompts. Only relative PNG paths with existing parents are accepted. Absolute, traversal, sensitive names, symlink ancestors and symlink final targets are refused using `WorkspacePathGuard`. No directories are created. Playwright returns an in-memory 1280×720 PNG, capped at 2 MiB. A private exclusive temporary file is written and synced, paths rechecked, then atomically renamed. The result contains a safe relative path, bytes and dimensions—never base64. **A text-only provider does not see image pixels.** Screenshots may contain sensitive page content; optional text redaction cannot redact pixels.
- `browser_close`: permanently closes this run registry. Subsequent calls fail safely.

Readonly is **not** a guarantee of no remote side effects: loading a page can run its scripts and send HTTP requests. Origin access approval explicitly warns of this. Network policy restricts destinations, not server behavior or HTTP methods within approved origins. It is not an OS/network sandbox; use host isolation for hostile sites or filesystem actors. Filesystem checks reject static symlink attacks and recheck before commit, but portable Node pathname APIs do not eliminate malicious concurrent ancestor replacement races.

## Network and lifecycle

Every routed HTTP request must have an allowed AND approved exact origin. HTTP fetches use `maxRedirects: 0`, and **all HTTP 3xx responses are rejected before fulfillment to Chromium**, including same-origin redirects and 3xx responses without Location. Redirect following is unsupported in this release: later Chromium redirect hops can bypass routing. There is no preflight or second request that returns a redirect. Navigate directly to an explicitly allowed canonical URL instead; normal origin approval still applies. After a rejected redirect, the next explicit navigation replaces only that failed page within the existing context (without relaunching or reopening a cancelled/disposed registry), so an immediate canonical navigation works even when the redirect was the first navigation. Late internal error/blank events from the old page cannot close its replacement; non-HTTP navigation on an active page remains denied. Service workers are blocked. All WebSockets are closed before handshake (including otherwise allowed origins). Extra pages/popups are closed and their HTTP requests denied. Downloads are disabled/cancelled. Unsupported URL schemes are rejected for tool navigation; unexpected frame navigation closes the registry. This is not a browser-engine security boundary against browser exploits.

Operations are serialized. Pre-aborted signals perform no operation. Any run signal abort permanently cancels the registry, closes Chromium, joins launch and routed work, and interrupts pending approvals even if their handler never settles. Disposal cancels first, then joins active work. Launch uses a finite timeout and closes a browser that finishes launching after cancellation. The caller's approval handler must honor its signal for its own UI/resource cleanup; an uncooperative external promise cannot be forcibly terminated.

Invalid arguments return `code: "invalid_input"` with bounded field constraints and no submitted values. Browser execution errors use authored generic messages rather than Playwright exception strings (which may contain query secrets, selectors or form text). Page text and approval descriptions support the optional redaction list. There is no automatic discovery of provider secrets.

## Verification

Real Chromium tests retain the original navigate/read/fill/click/artifact flow and add local two-server probes asserting **zero forbidden HTTP requests and zero WebSocket upgrades**, plus blocked service-worker fetches, popup policy, symlink/final-link/traversal/readonly screenshot denial, usable matching approval event IDs, secret-safe errors, unknown arguments, pre-abort, never-settling approval cancellation, delayed navigation cancellation and disposal during launch. Tests do not skip failures.

Run on a host with Chromium installed:

```sh
env FORGE_BROWSER_EXECUTABLE=/path/to/chrome pnpm exec vitest run tests/tools/browser.test.ts
pnpm exec tsc --noEmit --strict --exactOptionalPropertyTypes --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck src/tools/browser.ts src/tools/combined.ts tests/tools/browser.test.ts
```

These commands run only in a **source checkout** (they need the repository's `tests/` and `pnpm`); they are not part of the installed payload. The explicit host override was used for real-browser verification. Repository-wide checks may be affected by concurrent edits elsewhere in the checkout; the targeted typecheck isolates these exports without changing other files.
