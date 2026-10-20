# Root task budget

A root run owns one ledger, passed by identity to every child runtime. Local
`maxToolCalls` still caps each runtime, and a child's local ceiling cannot exceed
its parent's. `maxRootToolCalls` caps scheduled attempts across the whole tree;
when absent it uses the root's `maxToolCalls` (default 100). `rootTimeoutMs`
defaults to 30 minutes; it accepts 1 second through 24 hours. Root tool limits
accept 1–1,000,000. Configure with:

```
forge config set --max-tools 100 --max-root-tools 200 --root-timeout-ms 1800000
```

These optional additive settings leave older saved configuration readable. The
root timer starts after the host acquires the session and loads its settings,
before provider/tool construction. Direct runtime users start it at admission.
Approval waits, model retries/backoff, automatic summaries/title inference,
child construction, child waits and tool execution all spend the same elapsed
time. A monotonic clock enforces elapsed time; displayed timestamps are wall
clock diagnostics. Cleanup may take longer than the deadline because started
tools, child construction and owned child work must join before locks release.

## Admission and recovery

- A serial tool reserves one slot; a read batch atomically reserves its admitted
  size (at most four), against both local and shared remaining capacity.
- Intent is persisted before dispatch. Failed intent persistence or cancellation
  before dispatch releases only unused reservations. Dispatch is counted once;
  invalid arguments, denials and execution failures still consume that attempt.
- `spawn_agent` itself consumes a slot. If it consumes the last slot, it cannot
  construct/start a child. Each child tool consumes from the exact same ledger.
- No new provider request, tool dispatch or child construction starts when shared
  capacity is exhausted. There is no extra tool-free model finishing allowance.
  Deadline cancellation reaches approvals, tools and children; the runtime joins
  started tools/children even when terminal persistence or hooks fail. Provider
  adapters receive the same abort signal and retain their existing request
  timeouts/uncertain-response cancellation contract; unsafe requests never replay.
- Existing four-active/32-total/depth-one, worktree, permission and approval
  constraints still apply. A budget grants no access or consent.
- A ledger cannot enter the same session twice and a closed ledger cannot reopen.
  This is not crash-resumption of a root run. Existing interrupted recovery marks
  the old turn interrupted; an explicit newly accepted user input creates a new
  root run ID and a fresh ledger. Bound/uncertain queued inputs never auto-replay.

## Observations

`run_started` and `run_finished` optionally carry `budget`, preserving old event
records. It contains root ID, limits/deadline, consumed/reserved/remaining totals,
root stop reason and per-started-runtime counters/status/reason. A construction
failure before a child enters its runtime has no dispatched attempts and remains
visible in the existing child failure report. Root terminal state includes the
whole ledger (maximum 33 sessions); each child summary includes only its own
session row, so 32 reports do not repeat the entire ledger 32 times.

Usage fields sum actual provider-reported tokens, including observed memory,
summary and title model calls. Failed/unreported or still-pending requests count as missing.
Automatic title metadata preserves its existing bounded late-arrival behavior and
does not delay a successful answer. Its signal retains the original root deadline
even after the run closes. If it is still pending at terminal publication, that
observation remains incomplete; a late result never retroactively rewrites usage.
`basis: reported` is never an estimate; `complete: false` means totals are partial.
Provider cache tokens not returned are not invented. This is post-request usage
measurement, not an exact upfront token or currency spending cap. Existing own,
child and aggregate usage fields remain compatible; the budget's observation
ledger gives explicit missing-request counts.
