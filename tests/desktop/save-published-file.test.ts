import { createHash, randomUUID } from "node:crypto";
import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { savePublishedFileToFile } from "../../src/desktop/save-published-file";
import { rpcRequestSchema, workerRequestSchema } from "../../src/shared/ipc";

const data = Buffer.from([0, 1, 255, 23]);
const id = randomUUID();
const response = { file: { id, name: "报告.zip", mimeType: "application/zip", previewKind: "none", size: data.length, sha256: createHash("sha256").update(data).digest("hex"), createdAt: "2026-01-01T00:00:00Z" }, base64: data.toString("base64") };
it("saves authorized exact bytes to a native destination, supports cancellation and rejects symlink/hardlink targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-save-attachment-"));
  try {
    const destination = join(root, "report.zip");
    const choose = vi.fn(async () => destination);
    expect(await savePublishedFileToFile(id, { load: async () => response, choose })).toBe(true);
    expect(choose).toHaveBeenCalledWith("报告.zip");
    expect(await readFile(destination)).toEqual(data);
    const write = vi.fn();
    expect(await savePublishedFileToFile(id, { load: async () => response, choose: async () => undefined, write })).toBe(false);
    expect(write).not.toHaveBeenCalled();
    const outside = join(root, "outside");
    await writeFile(outside, "keep");
    const alias = join(root, "symlink");
    await symlink(outside, alias);
    await expect(savePublishedFileToFile(id, { load: async () => response, choose: async () => alias })).rejects.toMatchObject({ code: "storage" });
    const hard = join(root, "hardlink");
    await link(outside, hard);
    await expect(savePublishedFileToFile(id, { load: async () => response, choose: async () => hard })).rejects.toMatchObject({ code: "storage" });
    expect(await readFile(outside, "utf8")).toBe("keep");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("checks identity and integrity before a dialog or write; save RPC is main-process only", async () => {
  const choose = vi.fn();
  await expect(savePublishedFileToFile(randomUUID(), { load: async () => response, choose })).rejects.toMatchObject({ code: "storage" });
  await expect(savePublishedFileToFile(id, { load: async () => ({ ...response, base64: "eA==" }), choose })).rejects.toMatchObject({ code: "storage" });
  expect(choose).not.toHaveBeenCalled();
  const request = { id: randomUUID(), method: "savePublishedFile", sessionId: randomUUID(), fileId: id };
  expect(rpcRequestSchema.safeParse(request).success).toBe(true);
  expect(workerRequestSchema.safeParse(request).success).toBe(false);
});
