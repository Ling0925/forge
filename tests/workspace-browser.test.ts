import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKSPACE_DIRECTORY_LIMIT } from "../src/shared/workspaces";
import {
  WORKSPACE_SCAN_LIMIT,
  WorkspaceBrowseError,
  browseWorkspaceDirectory,
} from "../src/web/workspaces";

let temporary: string | undefined;
const previousForgeHome = process.env.FORGE_HOME;
/** Root ignores mode bits, so the EACCES case only runs as a normal user. */
const unreadable = process.getuid?.() === 0 ? it.skip : it;

/** A temporary directory tree only; the real user home is never touched. */
function fixture(): string {
  if (temporary === undefined) throw new Error("Missing fixture");
  return temporary;
}

beforeEach(async () => {
  temporary = await realpath(
    await mkdtemp(join(tmpdir(), "forge-workspace-browser-")),
  );
});

afterEach(async () => {
  const current = temporary;
  temporary = undefined;
  if (previousForgeHome === undefined) delete process.env.FORGE_HOME;
  else process.env.FORGE_HOME = previousForgeHome;
  if (current !== undefined)
    await rm(current, { recursive: true, force: true });
});

/** Capture the HTTP status of a rejected browse without leaking details. */
async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkspaceBrowseError) return error.status;
    throw error;
  }
  throw new Error("Expected the browse to fail");
}

describe("workspace directory browser: Given / When / Then", () => {
  it("given the launch workspace, when no path is requested, then lists only visible subdirectories in sorted order", async () => {
    const workspace = fixture();
    for (const name of ["zeta", "alpha", "middle", "Alpha"])
      await mkdir(join(workspace, name));
    for (const name of [".git", ".hidden", ".env"])
      await mkdir(join(workspace, name));
    await writeFile(join(workspace, "notes.txt"), "not a directory");
    await writeFile(join(workspace, "alpha", "inner.txt"), "nested file");

    const page = await browseWorkspaceDirectory(workspace);
    expect(page.path).toBe(workspace);
    // Only directories, no dotted entries, stable case-sensitive order.
    expect(page.directories.map((entry) => entry.name)).toEqual([
      "Alpha",
      "alpha",
      "middle",
      "zeta",
    ]);
    for (const entry of page.directories)
      expect(entry.path).toBe(join(workspace, entry.name));
    expect(page.directories.some((entry) => entry.name === "notes.txt")).toBe(
      false,
    );
    expect(page.truncated).toBe(false);
    // The containing temporary directory is a legitimate parent.
    expect(page.parent).toBe(dirname(workspace));
  });

  it("given an absolute subdirectory, when browsing it, then returns canonical paths and a real parent", async () => {
    const workspace = fixture();
    await mkdir(join(workspace, "project", "src"), { recursive: true });
    const project = join(workspace, "project");
    const page = await browseWorkspaceDirectory(workspace, project);
    expect(page.path).toBe(project);
    expect(page.parent).toBe(workspace);
    expect(page.directories).toEqual([
      { name: "src", path: join(project, "src") },
    ]);
    // A trailing separator and dot segments still canonicalize.
    expect(
      (await browseWorkspaceDirectory(workspace, `${project}/./`)).path,
    ).toBe(project);
    // Relative, empty, over-long and control-character spellings are 400 and
    // never reach the filesystem.
    for (const path of ["project", "", `/${"a".repeat(4200)}`, "/tmp/\u0000x"])
      expect(await statusOf(browseWorkspaceDirectory(workspace, path))).toBe(
        400,
      );
  });

  it("given a file, a missing path and a non-directory, when browsing, then answers 404 without internal detail", async () => {
    const workspace = fixture();
    await writeFile(join(workspace, "page.html"), "<p>file</p>");
    for (const path of [
      join(workspace, "page.html"),
      join(workspace, "missing"),
      join(workspace, "page.html", "below"),
    ]) {
      const error = await browseWorkspaceDirectory(workspace, path).catch(
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(WorkspaceBrowseError);
      const browseError = error as WorkspaceBrowseError;
      expect(browseError.status).toBe(404);
      expect(browseError.message).not.toMatch(/ENOENT|ENOTDIR|EACCES/);
      expect(browseError.message).not.toContain(workspace);
    }
  });

  it("given hidden, sensitive and protected directories, when requested directly, then refuses with 403 and omits them", async () => {
    const workspace = fixture();
    for (const name of [".git", ".ssh", ".env", "nested/.hidden"])
      await mkdir(join(workspace, name), { recursive: true });
    const state = join(workspace, "state");
    await mkdir(state);
    process.env.FORGE_HOME = state;

    for (const path of [
      join(workspace, ".git"),
      join(workspace, ".ssh"),
      join(workspace, ".env"),
      join(workspace, "nested", ".hidden"),
    ])
      expect(await statusOf(browseWorkspaceDirectory(workspace, path))).toBe(
        403,
      );
    // Forge state is protected even though it is not dot-prefixed.
    expect(await statusOf(browseWorkspaceDirectory(workspace, state))).toBe(403);
    // Protected state is omitted from listings as well as direct requests.
    const listing = await browseWorkspaceDirectory(workspace);
    expect(listing.directories.map((entry) => entry.name)).toEqual(["nested"]);
    expect(listing.parent).toBe(dirname(workspace));
  });

  it("given a workspace inside a hidden directory, when browsing it, then it works but advertises no parent", async () => {
    const workspace = fixture();
    const hiddenParent = join(workspace, ".hidden-parent", "workspace");
    await mkdir(join(hiddenParent, "inner"), { recursive: true });
    const page = await browseWorkspaceDirectory(hiddenParent);
    expect(page.path).toBe(hiddenParent);
    expect(page.parent).toBeNull();
    expect(page.directories.map((entry) => entry.name)).toEqual(["inner"]);
    // Requesting that same folder from another launch workspace is refused.
    expect(
      await statusOf(browseWorkspaceDirectory(workspace, hiddenParent)),
    ).toBe(403);
  });

  it("given a symlinked directory, when listed or requested, then it is never followed or returned", async () => {
    const workspace = fixture();
    const outside = join(workspace, "outside");
    await mkdir(join(outside, "elsewhere"), { recursive: true });
    await mkdir(join(workspace, "real"));
    await symlink(outside, join(workspace, "linked"));
    await symlink(join(outside, "elsewhere"), join(workspace, "linked-dir"));
    const page = await browseWorkspaceDirectory(workspace);
    expect(page.directories.map((entry) => entry.name)).toEqual([
      "outside",
      "real",
    ]);
    // Direct access through a symlink is refused, not resolved.
    for (const path of [
      join(workspace, "linked"),
      join(workspace, "linked-dir"),
    ])
      expect(await statusOf(browseWorkspaceDirectory(workspace, path))).toBe(
        403,
      );
  });

  unreadable(
    "given an unreadable directory, when listed, then answers 403",
    async () => {
      const workspace = fixture();
      const locked = join(workspace, "locked");
      await mkdir(locked);
      await chmod(locked, 0o000);
      try {
        expect(
          await statusOf(browseWorkspaceDirectory(workspace, locked)),
        ).toBe(403);
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  it("given many directories, when a page is built, then it is bounded, sorted and flagged truncated", async () => {
    const workspace = fixture();
    const total = WORKSPACE_DIRECTORY_LIMIT + 25;
    for (let index = 0; index < total; index += 1)
      await mkdir(join(workspace, `dir-${String(index).padStart(4, "0")}`));
    const page = await browseWorkspaceDirectory(workspace);
    expect(page.directories).toHaveLength(WORKSPACE_DIRECTORY_LIMIT);
    expect(page.truncated).toBe(true);
    const names = page.directories.map((entry) => entry.name);
    expect(names).toEqual([...names].sort());
    // Filesystem iteration order is not guaranteed; the returned subset is sorted.
    expect(new Set(names).size).toBe(WORKSPACE_DIRECTORY_LIMIT);
    expect(names.every(name => /^dir-\d{4}$/.test(name))).toBe(true);
  });

  it("given more entries than the scan budget, when listed, then the walk stops and reports truncation", async () => {
    const workspace = fixture();
    // Plain files are skipped but still counted by the scan budget, so the flag
    // cannot depend on which entries happen to come first.
    for (let index = 0; index < WORKSPACE_SCAN_LIMIT + 5; index += 1)
      await writeFile(
        join(workspace, `file-${String(index).padStart(4, "0")}.txt`),
        "",
      );
    const page = await browseWorkspaceDirectory(workspace);
    expect(page.directories).toEqual([]);
    expect(page.truncated).toBe(true);
  });
});
