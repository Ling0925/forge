import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { ForgeError } from "../shared/errors";
import { publishedFileResponseSchema } from "../shared/published-files";

/** Only a native dialog selects the destination; bytes come from the authorized
 * worker record, never renderer-supplied content or a workspace path. */
export async function savePublishedFileToFile(fileId: string, dependencies: {
  load: () => Promise<unknown>;
  choose: (name: string) => Promise<string | undefined>;
  write?: (path: string, bytes: Buffer) => Promise<void>;
}): Promise<boolean> {
  const response = publishedFileResponseSchema.parse(await dependencies.load());
  const bytes = Buffer.from(response.base64, "base64");
  if (response.file.id !== fileId || bytes.length !== response.file.size || bytes.toString("base64") !== response.base64
    || createHash("sha256").update(bytes).digest("hex") !== response.file.sha256)
    throw new ForgeError("storage", "Attachment integrity check failed.");
  const destination = await dependencies.choose(response.file.name);
  if (destination === undefined) return false;
  if (!destination) throw new ForgeError("storage", "No destination selected.");
  try { await (dependencies.write ?? writeBytes)(destination, bytes); }
  catch { throw new ForgeError("storage", "Could not save the attachment to the selected location."); }
  return true;
}
async function writeBytes(path: string, bytes: Buffer) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error("Not a regular file.");
    await handle.truncate(0);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
}
