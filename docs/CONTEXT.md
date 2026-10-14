# Project context and skills

This module (`src/context/**`, `src/tools/skills.ts`) implements bounded
project instruction and skill discovery for the harness. Hosts integrate via
the exported APIs of this module (`src/context/**`, `src/tools/skills.ts`); coordinator-local
`.build/` contract notes are **not shipped** and are not required reading.

## What it does

- **AGENTS.md discovery.** The workspace root `AGENTS.md` is loaded into the
  system context on every `refresh()`. Nested `AGENTS.md` files are *not*
  eagerly loaded: the model requests them for a specific workspace-relative
  path with the read-only `project_context` tool, which returns the root file
  plus every `AGENTS.md` on the chain from root to that path, ordered
  outermost-first (most specific last). Workspace trust is explicit — the
  service never searches parent directories, the home directory, or service
  secret stores.
- **Skill packages.** Directories containing `SKILL.md` are discovered in
  `.forge/skills`, `.agents/skills`, and (only when explicitly configured)
  user-owned directories passed via `extraSkillDirectories`. Frontmatter is
  parsed with a bounded YAML-lite parser (`name`, `description`, `version`).
  The system context receives **catalog metadata only** — skill bodies are
  lazily loaded through the `load_skill` tool.
- **Fingerprinting.** `getFingerprint()` returns a content hash, a version
  counter, and per-file signatures. Any change to instruction or skill sources
  changes the fingerprint; hosts surface this for prompt-prefix cache
  visibility and staleness detection between runs.

## Precedence and limits

| Rule | Behavior |
| --- | --- |
| Root `AGENTS.md` | Always applies, loaded at refresh |
| Nested `AGENTS.md` | Loaded only for explicitly accessed subtrees, root-first order |
| Parent directories | Never searched |
| Per-file body limit | 64 KiB; oversize is refused with an explicit warning, never silently truncated |
| File ceiling | 2 MiB hard maximum; binary (NUL) content rejected |
| Secret material | Rejected (private keys, token shapes, credential assignments) |
| Symlinks | Refused for instruction files, symlinked instruction ancestors, workspace skill roots and skill package directories. Explicitly configured user skill roots may themselves be symlinks and are contained by their resolved location. |
| Symlink swap after discovery | `load_skill` re-checks containment with `lstat`/`realpath` and reads only bounded regular files, so a directory or `SKILL.md` replaced by a link is refused |
| Bounded reads | Every file is read through one descriptor opened `O_NOFOLLOW`, capped at the byte ceiling plus one overflow sentinel; the descriptor's identity must match the pre-open `lstat`, so a file that grows past the ceiling — even when the growth happens after the reader's own stat result and before the descriptor read — or is swapped after discovery is refused rather than read whole |
| Path handling | Caller paths are canonicalized; `..` that escapes is rejected, and `a/../b` selects only `b` (no sibling leakage, no duplicated root) |
| Duplicate skill ids | First root wins; duplicates reported as warnings with provenance |
| Catalog size | 256 skills maximum; overflow reported as a warning |

The filesystem guarantee is cooperative, not an OS sandbox: refusal relies on
`lstat`/`realpath`/`O_NOFOLLOW` and on descriptor identity matching, which stops
a replaced final component, a symlinked ancestor directory and a file that grows
after discovery. Node does not expose portable directory-relative (`openat`)
traversal, so a process with arbitrary OS-level capabilities racing ancestor
directories is outside what this API can promise; the boundary holds against
cooperative writers and post-discovery replacement of last-known entries.

Skill files are instructions, not permission grants. `project_context` and
`load_skill` are read-only data tools; every other tool continues to obey core
permission policy. A missing nested `AGENTS.md` is normal and warns nothing;
only real symlink/oversize/binary/secret violations warn. Fingerprint
signatures hash bounded actual `SKILL.md` content, so a body-only edit
invalidates the hash even though only metadata is injected until load.

## Integration

```ts
const ctx = await createProjectContext(workspace);
await ctx.refresh();
// prepend ctx.getSystemContext() to the system message
// surface ctx.getFingerprint() and ctx.getCatalog() to UI/CLI
// call ctx.refresh() between runs to pick up changed files

const skillTools = createSkillTool(ctx); // LocalToolRegistry-shaped
```

Tests live in `tests/context/project-context.test.ts` and cover precedence,
nested scope, missing files, malicious symlinks, oversized budget (including a
file that grows past the ceiling after discovery), a final component replaced by
a symlink after discovery, duplicate skill ids, invalid metadata, lazy loading,
fingerprint invalidation, and absence of permission escalation.

### Stat-to-read growth regression

One regression pins the exact guarantee that distinguishes the bounded reader
from the previous unbounded pathname read: the fixture is **small when the
reader's `lstat` returns**, and only then is it grown on disk, immediately before
the descriptor read. The prior reader (an `lstat` size check followed by an
unbounded whole-file `readFile`) accepted the excess bytes; the descriptor-bounded
reader refuses them and surfaces an `oversized` warning.

The growth is deterministic and narrowly scoped. A single `vi.mock` for
`node:fs/promises` is inert unless a test arms it with an exact fixture path;
when armed, it appends to that one real file at the descriptor-open boundary and
records that it grew there (`grownBy === "open"`). The production code still
opens and reads the **real** descriptor — no descriptor IO is faked — and the
hook is restored after the test (and in `afterEach`) so no other test in the file
is affected.
