# Root task observations (no cumulative execution budget)

New runs have **no cumulative tool-call, child-agent count or root elapsed-time
limit**. A root run and all its children share an observation ledger, not an
admission quota. Long tasks can continue until completion, explicit cancellation
or an actual execution/provider/storage error.

## Compatibility and activation

- Saved `maxTurns`, `maxToolCalls`, `maxRootToolCalls` and `rootTimeoutMs` values
  remain readable and writable for compatibility, but are ignored by execution.
  Old saved limits do not need migration and cannot silently re-enable a budget.
- Legacy CLI flags `--max-turns`, `--max-tools`, `--max-root-tools` and
  `--root-timeout-ms` are accepted with a deprecation warning. They do not cap runs.
- `spawn_agent` no longer accepts `maxToolCalls`; children run without a separate
  tool allowance. Existing historical tool calls remain readable, not replayed.
- The local CLI loads the change after `node scripts/build-core.mjs` and restarting
  `forge`. An already running process retains its loaded implementation.

## Execution and cancellation

- Serial calls and read batches still record intent before dispatch. Failed intent
  persistence or cancellation before dispatch releases unused reservations.
  A dispatch is counted once, including invalid arguments, denials and failures;
  these counters never stop future work.
- Children still inherit permissions, have depth one and occupy at most four
  concurrent slots, released only after cleanup. There is no 32-child lifetime
  cap. Shared-workspace write ownership and worktree rules remain unchanged.
- Permission/approval checks, manual cancellation, repeated-identical-error
  protection, provider idle-data timeouts and individual tool timeouts remain.
  Removing a cumulative budget does not grant access or consent, remove output
  bounds, prevent provider quota exhaustion or promise crash/network recovery.
- Cancellation propagates to approvals, tools and children. Started work is joined
  before releasing locks, including when persistence or cleanup fails. Uncertain
  side effects are never automatically replayed.
- `wait_agents` accepts up to 32 explicit IDs per call (a report-size bound only).
  Without IDs it selects the next up to 32 undelivered current-run children;
  repeat without IDs for later pages. Active results are not marked delivered.
  Automatic parent reconciliation also delivers pages until all results are
  handled. Default and automatic pages shrink further when metadata is too large
  for the output byte bound; only actually returned IDs are marked delivered.
  The result-size bound does not become another child lifetime cap.
- A ledger cannot enter the same session twice or reopen after closing. Explicit
  new user input starts a fresh run ID and ledger; interrupted recovery does not
  resume or replay the old run automatically.

## Observations and historical records

`run_started` and `run_finished` keep their optional `budget` field for event
compatibility. New snapshots set `maxToolCalls`, `timeoutMs`, `deadlineAt`,
`remaining` and `stopReason` to `null`. There is no artificial huge numeric limit
and no elapsed-time timer. Old snapshots with numeric limits and `tools`/`deadline`
stop reasons remain readable.

The root terminal snapshot includes all started sessions and their counters,
status and reason, without the former 33-session schema bound. Child events and
reports include only their own session row instead of repeatedly copying the
whole growing tree. Aggregate counters remain shared. A failure before a child
enters its runtime is visible in the child failure report without inventing
executed attempts.

Usage sums actual provider-reported tokens, including observed memory, summary
and title calls. Failed, unreported or still-pending requests count as missing.
Automatic title inference retains its separate bounded lifetime and does not
delay a successful answer. A late result never rewrites a closed ledger.
`basis: reported` is not an estimate; `complete: false` means totals are partial.
No token/currency admission cap is implied: longer runs can incur more provider
cost and use more local resources, and the user can stop them manually.
