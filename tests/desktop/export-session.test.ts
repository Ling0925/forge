import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportSessionToFile } from "../../src/desktop/export-session";
import {
  parseSessionId,
  sessionSnapshotSchema,
} from "../../src/shared/schemas";

const id = parseSessionId("10000000-0000-4000-8000-000000000001");
const snapshot = sessionSnapshotSchema.parse({
  version: 1,
  id,
  title: "Test",
  workspace: "/tmp",
  model: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  status: "completed",
  messages: [],
  events: [],
  changes: [],
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), "forge-export-test-"));
  directories.push(path);
  return path;
};

describe("native session export seam", () => {
  it("does not load or write a session when the native dialog is canceled", async () => {
    let loaded = false;
    expect(
      await exportSessionToFile(id, {
        choose: async (name) => {
          expect(name).toContain(id);
          return undefined;
        },
        load: async () => {
          loaded = true;
          return snapshot;
        },
      }),
    ).toBe(false);
    expect(loaded).toBe(false);
  });
  it("writes the validated authoritative snapshot to the selected local file", async () => {
    const destination = join(await directory(), "session.json");
    expect(
      await exportSessionToFile(id, {
        choose: async () => destination,
        load: async (selected) => {
          expect(selected).toBe(id);
          return snapshot;
        },
      }),
    ).toBe(true);
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(snapshot);
  });
  it("replaces an existing regular file only after selection and refuses symlinks", async () => {
    const folder = await directory();
    const destination = join(folder, "session.json");
    const write = {
      choose: async () => destination,
      load: async () => snapshot,
    };
    expect(await exportSessionToFile(id, write)).toBe(true);
    expect(await exportSessionToFile(id, write)).toBe(true);
    const target = join(folder, "target.json");
    await symlink(destination, target);
    await expect(
      exportSessionToFile(id, { ...write, choose: async () => target }),
    ).rejects.toMatchObject({ code: "storage" });
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(snapshot);
  });
  it("rejects mismatched snapshots and reports failed writes without claiming success", async () => {
    const destination = join(await directory(), "session.json");
    await expect(
      exportSessionToFile(id, {
        choose: async () => destination,
        load: async () => ({
          ...snapshot,
          id: parseSessionId("10000000-0000-4000-8000-000000000002"),
        }),
      }),
    ).rejects.toMatchObject({ code: "storage" });
    await expect(
      exportSessionToFile(id, {
        choose: async () => destination,
        load: async () => snapshot,
        write: async () => {
          throw Error("filesystem detail");
        },
      }),
    ).rejects.toMatchObject({
      code: "storage",
      message: "Could not save the session to the selected file.",
    });
  });
});
