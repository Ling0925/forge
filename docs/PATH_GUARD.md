# Forge workspace path guard

This standalone, original helper uses Node filesystem APIs, not shell commands or an agent runtime dependency.

## API and contract

`createWorkspacePathGuard(workspace)` asynchronously returns a guard with a readonly canonical absolute `root`, `resolveRead(relative)`, and `resolveWrite(relative)`. Construction applies `realpath` to the supplied workspace and requires a directory. A workspace supplied through a symlink is intentionally allowed: its canonical destination becomes the trust root. Returned guard properties are frozen.

Both resolution methods return an absolute pathname, not an open handle. They do not create, read, overwrite, or otherwise modify files.

- **Read:** the target must exist and be a regular file or directory. `.` lists the workspace root.
- **Write:** the parent must already exist as a real directory. The final target must be either a regular file or a missing basename. Existing directories are rejected with `NOT_DIRECTORY`, including `.`. This API is exclusively for write-file targets, not directory creation. Other filesystem object types are rejected with `INVALID_PATH`.
- All existing components below the canonical root, including the final target, are inspected without following symlinks. Internal, external, and dangling symlinks are all rejected with `SYMLINK`.
- Empty input and null bytes are rejected. Native absolute paths and Windows absolute spellings are rejected with `OUTSIDE_WORKSPACE`; Windows drive-relative spellings such as `C:notes` are rejected with `INVALID_PATH`.
- Paths use native separators (Windows also accepts `/`). On POSIX, a backslash in an otherwise relative filename is an ordinary character. Ordinary Unicode and spaces are preserved.
- Repeated separators, trailing separators, and `.` components are ignored. Trailing separators do not request directory semantics. Lexical `..` is allowed only if it never escapes the root, even temporarily. Components canceled by `..` are still checked: `alias/../file` cannot conceal a symlink, missing directory, or non-directory at `alias`.
- Missing intermediate directories are never permitted, even if later canceled by `..`. Prefix-sharing siblings are outside the workspace, not descendants.

## Errors

`WorkspacePathError` exports readonly `code` and `relativePath` fields. Codes are `OUTSIDE_WORKSPACE`, `SYMLINK`, `NOT_DIRECTORY`, `MISSING`, and `INVALID_PATH`. `NOT_DIRECTORY` covers both non-directory parents and directories supplied as write-file targets. Missing filesystem entries map to `MISSING`; unclassified filesystem failures, including permission failures, map to `INVALID_PATH`.

`relativePath` is the normalized, workspace-relative requested target, or `.` for the root. It is `null` for rejected lexical inputs and root canonicalization failures. Messages contain only the code; raw filesystem exceptions, absolute workspace paths, and rejected absolute inputs are not attached. Relative filenames may themselves contain sensitive user content, so callers should still apply their own logging/redaction policy. Error fields are TypeScript-readonly; errors are not a security boundary against mutation by callers.

## Security limits and tool integration

Pathname checks do **not** create an OS sandbox. These asynchronous checks cannot alone defeat hostile concurrent directory mutation. A directory can be replaced after inspection, including the workspace root, or between inspection and opening a file. Re-resolving a returned string does not eliminate that race. Hard links and mounted filesystems are not rejected; filesystem identity and provenance are outside this helper's contract.

Tool implementations must use bounded atomic operations and recheck relevant paths immediately before acting. For writes, use exclusive temporary-file creation in a validated parent, bounded content sizes, appropriate no-follow/open protections where available, and atomic publication with an explicitly chosen overwrite policy. Revalidate parent and destination before publication and clean up temporary files on failure. Apply equivalent handle-based checks to reads. Rechecks reduce accidental races but do not prove safety against an adversarial writer; strong confinement needs OS isolation or platform-specific directory-handle-relative operations. Do not expose arbitrary writes in a workspace concurrently controlled by an untrusted process on the strength of this helper alone.

The Vitest suite uses fresh real temporary directories per test, removes them afterward, and exercises normal paths, lexical boundaries, symlinks, missing entries, directory/file distinctions, canonical roots, and Unicode filenames without sleeps or global permission changes.
