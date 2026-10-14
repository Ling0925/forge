# Original implementation plan

## Scope and provenance

Desktop Harness will be a new Electron/React/TypeScript desktop application and CLI sharing an original agent runtime. It targets coding and local tasks, not merely chat. No existing agent harness or agent engine will be copied, forked, adapted, or used as a dependency. Ordinary HTTP, validation, UI, and platform libraries are acceptable. All source, tests, scripts, and build configuration must be authored by API models; the coordinating reviewer inspects proposals and applies accepted patches rather than writing implementation code.

The development dispatcher in `.build/dispatch.mjs` is proposal-only infrastructure, not the runtime. Run it from the project root with a single task JSON filename. It reads only the designated development credential file, makes direct nonstreaming requests, and never applies patches or executes generated files. Each model gets at most one request. Attempts retain sanitized request and response artifacts; successful proposals include a patch and SHA256 manifest. Protected context requests fail explicitly rather than silently losing context. Credential values detected in inputs or proposals cause rejection. Artifact redaction is defense in depth, not a general-purpose detector for all possible secrets.

The reviewer must inspect both complete proposal contents and the patch. The apply_patch format is line-oriented and may normalize a missing terminal newline; hashes in the manifest describe exact proposed strings, not a promise about an external patch tool's newline behavior. Existing file hashes support a reviewer-side stale-input check. Filesystem checks reject symlinks but are not a race-proof sandbox against concurrent hostile changes; run dispatch in a trusted development workspace and do not mutate that workspace during dispatch.

## First release behavior

The shared runtime will perform real read, list, search, write, edit, and shell tool execution through explicit original adapters. Browser tools can be added using Playwright through a separately authored adapter. A bounded agent loop will enforce turn, tool-call, time, output, and token budgets, serialize tool effects, emit typed events, and stop predictably on completion, cancellation, exhausted budgets, or failure. Tool schemas and results are data, never executable model instructions.

API compatibility starts with an OpenAI-compatible chat-completions transport, including text content and tool calls. Provider quirks belong in transport normalization, not the loop. Credentials belong in a credential service, are passed only to transport, and never enter session transcripts, tool arguments, diagnostic headers, or renderer state. Development dispatcher credentials are not production application configuration.

Sessions will use versioned durable records with append-only events and atomic checkpoints. Resume reconstructs settled turns and pending state without replaying side effects automatically. Interrupted shell or browser actions are reported as uncertain rather than executed again. Cancellation propagates through transport and tools. Model changes are allowed only between settled turns, recorded as events, and cannot mutate an in-flight request.

Both interfaces will display streamed runtime events, tool approvals, failures, budget state, and file-change summaries. The desktop app uses a sandboxed renderer, narrow typed IPC, and privileged tool execution in the main process or a dedicated worker. The CLI uses the same session and loop APIs, supports resume and cancellation, and provides human-readable output plus an optional machine-readable event stream.

Safe defaults include workspace confinement, explicit symlink policy, bounded reads and outputs, subprocess argument arrays rather than implicit shell interpolation, restricted browser navigation, secret-aware logging, and approval before destructive writes or shell execution. Shell tools are powerful and are not presented as a secure OS sandbox. Users must deliberately authorize higher-risk capabilities.

## Disjoint parallel ownership and contracts

Agree on versioned contracts first, then dispatch these independently owned tasks. Tasks may import contracts but may not edit another owner's paths.

- `packages/contracts/`: exports `SessionId`, `AgentEvent`, `TurnRequest`, `ToolCall`, `ToolResult`, `ToolDefinition`, `Budget`, and transport/session interfaces; owns schema and contract tests.
- `packages/runtime/`: exports `createAgentRuntime(dependencies)` with `runTurn`, `cancel`, and `setModelAtBoundary`; owns the bounded loop and deterministic fake-tool tests. Depends only on contracts and injected services.
- `packages/transport/`: exports `createChatTransport(config, credentialProvider)` and normalized response/event types; owns HTTP compatibility, cancellation, timeout, retry policy, and fixture tests. Does not execute tools.
- `packages/tools-local/`: exports `createLocalToolRegistry(workspace, approvalService)`; owns read/list/search/write/edit/shell implementations and confinement tests. Does not drive model requests.
- `packages/tools-browser/`: exports `createBrowserToolRegistry(policy)`; owns the optional original Playwright adapter, browser lifecycle, and navigation policy tests.
- `packages/sessions/`: exports `openSessionStore(directory)` with append, checkpoint, load, and list operations; owns migrations, recovery, durability, and interrupted-operation tests.
- `apps/cli/`: exports `runCli(argv, services)`; owns CLI entry points, event formatting, and CLI integration tests. No duplicate runtime.
- `apps/desktop/`: owns Electron main/preload, React renderer, typed IPC adapters, event views, approvals, and file-change UI. Imports the shared runtime; renderer never receives credentials.
- `packages/security/`: exports credential loading, redaction, and policy utilities; owns focused security tests without owning other packages' behavior.
- `build/` and root packaging configuration: separate API-author task owns workspace scripts, CI, dependency pinning, desktop packaging, CLI installation, and end-to-end smoke tests after package contracts stabilize. `.build/dispatch.mjs` remains development-only and is excluded from installed application artifacts.

Installation deliverables should include platform-appropriate Electron installers, a documented CLI executable/package, versioned configuration and session storage locations, upgrade and uninstall instructions, and clean-machine smoke tests. Keep API-author task IDs, model identifiers, hashes, and reviewer acceptance records as provenance without retaining credentials. The current two-file proposal implements only dispatch infrastructure and this architecture note; it does not claim the application or runtime already exists.
