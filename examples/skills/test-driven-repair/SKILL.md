---
name: test-driven-repair
description: Reproduce a failure with a failing test before changing code, then fix and verify.
version: 1.0.0
---

# Test-driven repair

Use this skill when a bug report, crash, or failing behavior needs a fix.

1. **Reproduce first.** Write the smallest failing test that demonstrates the
   reported behavior. Do not edit implementation code before the test exists
   and fails for the expected reason.
2. **Confirm the failure mode.** Read the test output. If it fails for a
   different reason than reported, stop and re-scope the test.
3. **Apply the minimal fix.** Change the least code that makes the test pass.
   Prefer narrow edits over refactors during repair.
4. **Verify.** Run the targeted test, then the surrounding suite for the
   touched module. Do not declare success from a single passing run if the
   change affects shared contracts.
5. **Record the outcome.** Summarize: what failed, the test added, the fix,
   and anything the test cannot yet cover.

Rules:

- Never delete or weaken a test to make it pass.
- Never mock results the user must observe.
- If the root cause is unclear after one fix attempt, report the evidence
  instead of guessing further.
