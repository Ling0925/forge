import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { ForgeError } from "../shared/errors";
import { type SessionId, sessionSnapshotSchema } from "../shared/schemas";

/** The main process alone selects the destination and loads the authoritative snapshot. */
export async function exportSessionToFile(
  sessionId: SessionId,
  dependencies: {
    choose: (defaultName: string) => Promise<string | undefined>;
    load: (sessionId: SessionId) => Promise<unknown>;
    write?: (path: string, contents: string) => Promise<void>;
  },
): Promise<boolean> {
  const destination = await dependencies.choose(
    `forge-session-${sessionId}.json`,
  );
  if (destination === undefined) return false;
  if (!destination)
    throw new ForgeError("storage", "No export destination was selected.");
  const snapshot = sessionSnapshotSchema.parse(
    await dependencies.load(sessionId),
  );
  if (snapshot.id !== sessionId)
    throw new ForgeError(
      "storage",
      "The exported session did not match the requested session.",
    );
  const contents = `${JSON.stringify(snapshot, null, 2)}\n`;
  try {
    await (dependencies.write ?? writeExport)(destination, contents);
  } catch {
    throw new ForgeError(
      "storage",
      "Could not save the session to the selected file.",
    );
  }
  return true;
}

async function writeExport(path: string, contents: string): Promise<void> {
  // The native dialog authorizes replacement; O_NOFOLLOW prevents substituting a symlink
  // between that confirmation and this write. No path ever crosses the renderer boundary.
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!(await file.stat()).isFile())
      throw new Error("Export destination must be a regular file.");
    await file.truncate(0);
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}
