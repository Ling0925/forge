# Forge reviewer ledger

User-authorized work started 2026-10-13 01:42:44 UTC. Hard delivery deadline: 2026-10-13 09:42:44 UTC (17:42:44 Asia/Shanghai).

This ledger records development checkpoints. Final release acceptance and current artifact paths are recorded separately in `.omo/evidence/final-review.md` after packaging and installed-surface QA.

## Constraints

- Deliver desktop and CLI sharing an original agent runtime.
- Initial code was authored through the supplied API. The user subsequently authorized the reviewer to implement the minimum runtime bootstrap directly, then return all further feature implementation to API models through that runtime. The bootstrap exception covers runtime event typing/streaming/cancellation, CLI schema/argument/budget handling, local async tool error handling, configured-key redaction wiring, bounded snapshot reads and their focused tests. Subsequent product source is authored by API model tool calls.
- Reference existing designs and documented protocols; do not copy, fork or adapt an existing harness.
- Make routine choices autonomously; user will not answer questions.
- Development credentials remain in a private file outside this repository.

## Acceptance ledger

- [x] CLI completes a real task through model tool calls.
- [x] Native desktop completes a real task through the same core.
- [x] Sessions survive restart and can be resumed from either interface.
- [x] Cancellation stops active network/tool work, including subprocesses.
- [x] Permissions enforce workspace boundaries and shell approval.
- [x] API errors and unavailable models appear with actionable results.
- [ ] Original build is type checked, meaningfully tested and packaged.
- [ ] Desktop visual and functional QA captured on the current build.
- [ ] Deliverables and source have no supplied API key.
- [ ] API authorship manifest covers code, tests, scripts and configuration.

## Evidence and review notes

- API discovery returned 68 model IDs. cx/gpt-6.1-sol and cbcn/glm-5.3 answered connectivity probes. Kimi probe used its tiny token budget for reasoning; that probe does not establish output failure at normal budgets.
- cx/gpt-6.1-sol returned a native function tool call with valid JSON arguments.
- Bootstrap author: cx/gpt-6.1-sol. Original request/response retained in .build/bootstrap-*.json. Reviewed and accepted .build/dispatch.mjs and IMPLEMENTATION_NOTES.md. Node syntax check passed. Dispatcher produces proposals only and rejects path escapes, symlinks, protected context, credential strings and incomplete model output. It runs in a trusted development workspace; its path checks are not an OS sandbox.
- Independent API requests now author shared contracts/build configuration and DESIGN.md. Application source has not yet been generated.
- UI references actually viewed: OpenHands product/CLI marketing screenshot (not useful as an app layout); Sunsama general settings screenshot (grouped field rows, contextual descriptions, quiet navigation). StyleGallery scroll-body-shell and supporting-pane contracts reviewed for scroll ownership and task/inspection hierarchy. These are inspiration only; no reference assets or code are shipped.

### Bootstrap review, 2026-10-13 02:19 UTC

- User steering: once the original runtime works, route further API implementation through its persistent sessions and native tools. No further clarification questions.
- Reviewed API-authored shared schemas, build, original path guard, persistence, runtime, local tools and CLI. Code remains API-authored. Owner-only development credentials stay outside the source tree.
- The gateway returned HTTP 503 for a long nonstream request with a streaming-to-JSON reset message. API-authored dispatcher switched to SSE. Live SSE cleanly closes after finish_reason without a DONE marker; compatibility patch accepts a valid terminal completion and clean EOF, and rejects incomplete transport.
- Path guard: 16 real filesystem tests passed. Bootstrap domain tests after schema repairs: 46 passed, 8 failed. Failures exposed CLI readonly schema access and asynchronous tool failures escaping the result boundary; fixes assigned to API authors, not suppressed.
- Review fixes also address cancellation settlement before lock release, 80ms streaming event coalescing, whole-path validation before mkdir, useful child executable paths, and credentials versus ordinary source expressions.
- Dependencies installed with pnpm 11.18.0. Build script approval executed for Biome and esbuild; Windows-only installer declined. pnpm-generated lock/workspace metadata is generated tooling data, not handwritten implementation.
- Electron installer required Node's explicit environment proxy support; initial direct fetch failed. Retry uses NODE_USE_ENV_PROXY=1 and will be verified before GUI claims.

### Runtime self-development, 2026-10-13 02:35 UTC

- Reviewer applied the user-authorized minimum bootstrap repairs. API local proposal 11 source was accepted, retaining all existing local-tool tests and adding its additional tests in a separate file. All 97 tests and TypeScript passed. Electron 44.7.0 launches under Xvfb.
- Real CLI smoke session 9ca9a66e-b5aa-46f7-8c76-d68a7fee70bb used cx/gpt-6-luna to list a workspace, write hello.txt, execute Node verification and return completed. Transcript: .build/runtime-runs/bootstrap-smoke.jsonl.
- Feature development now uses persistent Forge CLI sessions, native tool calls, stable message prefixes and per-session file read cache. No claim of upstream prompt-cache hits has been made; provider usage does not yet expose that field.
- Concurrent API owners: cx/gpt-6-astra desktop host, ag/gemini-3.8-flash renderer primitives, cx/gpt-6-luna browser tools. cbcn/kimi-k3-1 and cbcn/glm-5.3 returned a protocol error for the store task; compatibility is being investigated before retrying.
- Read-only bootstrap review found an unrecoverable crash-left gate lock. Store worker tasked with real process-crash/concurrency regression tests. A separate reproduced approval-cancellation checkpoint race must be fixed before desktop acceptance.

### Model change, 2026-10-13 02:56 UTC

- User requested replacing Gemini because its quota is nearly exhausted. Gemini renderer run was interrupted with SIGINT, persisted cancelled status, exit130; no further Gemini calls authorized for this task. Its existing source and transcript are retained.
- cbcn/glm-5.3 takes over the same renderer session. Both GLM and Kimi completed real native write/read smoke tasks after duplicated-DONE compatibility repair. Smoke session IDs: 8c365e3b-6c3f-4ef5-9b24-d68ae9f1cfbe and e4a3c187-9c42-4c35-a139-571f1c391dd1.
- The gateway emits two terminal DONE markers. Parser now treats repeated markers idempotently only after a valid finish, still rejects substantive post-terminal data and incomplete native calls. Runtime/provider/local targeted59tests passed independently; approval cancellation checkpoint race repaired.

### Native desktop verification, 2026-10-13 03:07 UTC

- Actual Electron44 window under Xvfb, with real preload/IPC/worker/harness/provider: session14652c5a-3add-42b9-afa1-91d8fef03a72 completed native model write/read of desktop.txt, persisted completed status, no page errors. UI at that checkpoint was still the honest bootstrap screen; this proves desktop host/core transport, not completed product UI.
- First shutdown probe issued an absolute command cwd and correctly failed workspace-relative path validation; it did not start a child. The probe was corrected to use relative cwd.
- Actual window-close cancellation: sessiond5187154-ba78-4092-9db2-8deb8a0d6760 started a real Node subprocess, PID2594793. Closing BrowserWindow waited for cleanup; observed childRunning=false, close103ms, persisted statuscancelled and finalrun_finished. Evidence comes from real host/runtime, not a fixture Harness.
- Renderer development moved from GLM to cx/gpt-6.1-sol while investigating an additional duplicated terminal-frame gateway shape. Gemini remains stopped. Kimi concurrently authors browser/cache integration; cx/gpt-6-sol authored release tooling. API-generated code is reviewed before acceptance.

### Integration review, 2026-10-13 03:24 UTC

- First-migration endpoint/key race repaired by committing authoritative settings/state.json inside initialization lock before readers are exposed. Final lock cancellation repair checks abort after final descriptor verification. Independent full store15tests and four concurrent deterministic cancellation reruns passed. Reports in .omo/evidence/bootstrap-store-*-code-review.md retain rejected earlier stages and current approval.
- Real GLM stream diagnostic captured two identical tool_calls finish frames, the second carrying final usage, followed by duplicated DONE. API provider author accepts only harmless same-reason terminal frames and null optional cache metadata, retains rejection of conflicting/substantive continuations. Provider70tests passed; GLM then successfully completed a native-tool source/format/test development task through the rebuilt Forge CLI.
- Browser final review approved7realChromiumtests, including first-navigation2hop redirect denial with0forbiddenrequests followed immediately by successful direct canonical navigation. Automatic3xxredirects remain explicitly unsupported.
- Kimi added opt-in browser origins/executable settings and actual provider-reported cachedPromptTokens, preserving unknown versus0. Built artifacts include Playwright JavaScript; a browser executable is needed only when browser tools launch.
- First actual product UI task81593499-f6d0-4bd8-9542-ed8371608713 wrote qa.txt and reached command approval via real Electron/IPC/runtime,0pageerrors. QA exposed blocked first-setup model discovery and a broken narrow layout; those screenshots document failures, not acceptance. UI author is fixing them plus state/draft/permission races from independent review.
- Release scriptHIGHfindings repaired: valid provenance output containment and full checksummed payload manifest binding. Final selfcheck isolation/documentation fixes remain under review; no release or install claim yet.

### Product acceptance checkpoint, 2026-10-13 03:42 UTC

- Final core suite204/204 passed, strict TypeScript passed. Renderer-scoped React Doctor reports no errors after API-authored committed-ref lifecycle corrections; advisory complexity/static-line/performance warnings are reviewed separately. Full-source audit also scanned excluded historical proposal data; exact supplied key was absent from all four flagged proposal files. No diagnostic suppression was added.
- Real Electron first setup fetched68models before selecting a model; password field was empty on reopening and authoritative credential/settings file mode0600. Real command approval produced stdout verified and exit0; denial left denied.txt absent; cancellation killed real childPID2699554. Session86d19ced-8324-4761-bd18-3332a03f2b04 retained all outcomes after restart.
- The same session resumed through CLI with cbcn/glm-5.3, read approved.txt and returned CLI_BRIDGE_OK:approved-ok; desktop refresh displayed that actual assistant result. Renderer correctly showed completed/failed/failed for the approved/denied/cancelled command tools after reload. Provider reported2816cachedprompttokens for the GLM continuation, displayed by the real UI; no guarantee is made for other requests/providers.
- Native desktop parallel sessions: Luna cb58983b-3b47-4c70-bb4c-56ffb234dd85 awaited approval while Kimi00e6a613-87f5-4800-9bdc-23f273dc23f7 independently wrote/read parallel-b.txt. Both completed, background approval routed to its owning session. Nonexistent model returned explicitHTTP404 and retained a failed session.
- Live browser CLI session2dd1a2f0-529b-454b-9536-d62393c8adff used browser_navigate/fill/click/read/screenshot against a task-owned local origin. Actual screenshot shows Hello, Forge; session completed without errors.
- Desktop dark/light1440/1920/639/390 captures show bounded task/composer geometry with no page horizontal overflow and reachable inspector. Earlier failure screenshots remain historical evidence; final fresh visual set and installed-app checks follow in the final report.
- Release tooling independently APPROVE after8selfchecks including EEXIST preservation, unique owned fixture cleanup, exact unique checksums, changed-payload and symlink rejection. Actual packaging/install still pending at this checkpoint.
