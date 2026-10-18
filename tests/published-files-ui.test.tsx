import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { parseSessionId, sessionSnapshotSchema } from "../src/shared/schemas";
import { reduceTimeline } from "../src/renderer/state/timeline";

const file = { id: randomUUID(), name: "报告.md", size: 12, sha256: "a".repeat(64), mimeType: "text/plain", previewKind: "text", createdAt: "2026-01-01T00:00:00Z", description: "报告快照" };
const id = parseSessionId(randomUUID());
const call = { id: "publish", type: "function", function: { name: "publish_file", arguments: "{}" } };
function snapshot(name = "publish_file", isError = false) {
  return sessionSnapshotSchema.parse({ version: 1, id, workspace: "/workspace", title: "fixture", model: "fixture", status: "completed", createdAt: file.createdAt, updatedAt: file.createdAt, changes: [], events: [
    { type: "run_started", sessionId: id, timestamp: file.createdAt, model: "fixture", permission: "workspace" },
    { type: "run_finished", sessionId: id, timestamp: "2026-01-01T00:00:01Z", status: "completed", turns: 2, toolCalls: 1 },
  ], messages: [
    { role: "user", content: "make report" },
    { role: "assistant", content: null, tool_calls: [{ ...call, function: { ...call.function, name } }] },
    { role: "tool", tool_call_id: call.id, content: JSON.stringify({ content: "published", isError, files: [file] }) },
    { role: "assistant", content: "Delivered" },
  ] });
}
it("restores real publish results but not failed/external results; live and saved cards match", () => {
  const saved = reduceTimeline(snapshot());
  expect(saved.find(item => item.kind === "tool")).toMatchObject({ files: [file], status: "completed" });
  for (const s of [snapshot("run_command"), snapshot("publish_file", true)])
    expect(reduceTimeline(s).some(item => item.kind === "tool" && item.status === "completed" && item.files?.length)).toBe(false);
  const live = sessionSnapshotSchema.parse({ ...snapshot(), status: "running", messages: [{ role: "user", content: "make report" }], events: [
    { type: "run_started", sessionId: id, timestamp: file.createdAt, model: "fixture", permission: "workspace" },
    { type: "tool_started", sessionId: id, timestamp: file.createdAt, call },
    { type: "tool_finished", sessionId: id, timestamp: file.createdAt, toolCallId: call.id, result: { content: "published", isError: false, files: [file] } },
  ] });
  expect(reduceTimeline(live).find(item => item.kind === "tool")).toMatchObject({ files: [file], status: "completed" });
});

it("mounts visible attachments, safe text/image previews, downloads, errors and Blob cleanup", async () => {
  const image = { ...file, id: randomUUID(), name: "pixel.png", size: 68, mimeType: "image/png", previewKind: "image" };
  const html = { ...file, id: randomUUID(), name: "page.html", size: 34, mimeType: "text/html", previewKind: "html" };
  const large = { ...file, id: randomUUID(), name: "large.md", size: 1048577 };
  const svg = { ...file, id: randomUUID(), name: "vector.svg", mimeType: "image/svg+xml", previewKind: "none" };
  const bad = { ...file, id: randomUUID(), name: "missing.txt" };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const bundle = await build({ stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import {createRoot} from 'react-dom/client';
    import {PublishedFiles} from './src/renderer/components/workbench/PublishedFiles';
    import {StoredTranscript} from './src/renderer/components/workbench/Transcript';
    const files = ${JSON.stringify([file, image, html, large, svg, bad])};
    window.created=[]; window.revoked=[];
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=b=>{const u=create(b);window.created.push(u);return u};
    URL.revokeObjectURL=u=>{window.revoked.push(u);revoke(u)};
    window.forge={getPublishedFile:async(_,id)=>{const file=files.find(f=>f.id===id);if(file.name==='missing.txt')throw new Error('读取失败');return {file,base64:file.previewKind==='image'?'${png}':btoa(file.previewKind==='html'?'<script>window.pwned=true</script>':'<b>safe</b>!')}}};
    window.root=createRoot(document.getElementById('root'));
    window.root.render(<><StoredTranscript snapshot={${JSON.stringify(snapshot())}}/><PublishedFiles sessionId="${id}" files={files.slice(1)}/></>);
  ` }, bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "ui.js", loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(4000);
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: bundle.outputFiles.find(f => f.path.endsWith(".css"))!.text });
    await page.addScriptTag({ content: bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text });
    const report = page.getByRole("article", { name: "附件 报告.md", exact: true });
    await expect.poll(() => report.isVisible()).toBe(true);
    await report.getByRole("button", { name: "预览", exact: true }).click();
    expect(await page.getByRole("dialog").locator("pre").innerText()).toBe("<b>safe</b>!");
    expect(await page.getByRole("dialog").locator("b").count()).toBe(0);
    await page.getByRole("button", { name: "关闭面板" }).click();
    const downloadEvent = page.waitForEvent("download");
    await report.getByRole("button", { name: "下载", exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(file.name);
    await download.delete();
    const imageCard = page.getByRole("article", { name: "附件 pixel.png", exact: true });
    await expect.poll(() => imageCard.locator("img").count()).toBe(1);
    await imageCard.getByRole("button", { name: "预览", exact: true }).click();
    expect(await page.getByRole("dialog").locator("img").count()).toBe(1);
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page.getByRole("article", { name: "附件 page.html", exact: true }).getByRole("button", { name: "预览", exact: true }).click();
    await expect.poll(() => page.getByRole("dialog").locator("pre").innerText()).toBe("<script>window.pwned=true</script>");
    expect(await page.getByRole("dialog").locator("script").count()).toBe(0);
    expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
    await page.getByRole("button", { name: "关闭面板" }).click();
    expect(await page.getByRole("article", { name: "附件 large.md", exact: true }).getByRole("button", { name: "预览", exact: true }).count()).toBe(0);
    expect(await page.getByRole("article", { name: "附件 vector.svg", exact: true }).locator("img").count()).toBe(0);
    await page.getByRole("article", { name: "附件 missing.txt", exact: true }).getByRole("button", { name: "下载", exact: true }).click();
    await expect.poll(() => page.getByRole("alert").last().innerText()).toBe("读取失败");
    await page.evaluate(() => { (window as any).nativeSaves = []; (window as any).forge.savePublishedFile = async (...args: unknown[]) => { (window as any).nativeSaves.push(args); return false; }; });
    await report.getByRole("button", { name: "下载", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).nativeSaves)).toEqual([[id, file.id]]);
    await page.evaluate(() => (window as any).root.unmount());
    expect(await page.evaluate(() => (window as any).created.every((u: string) => (window as any).revoked.includes(u)))).toBe(true);
  } finally { await browser.close(); }
});
