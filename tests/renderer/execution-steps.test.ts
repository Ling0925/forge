import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { executionTurns } from "../../src/shared/execution";
import { sessionSnapshotSchema } from "../../src/shared/schemas";
import { reduceTimeline } from "../../src/renderer/state/timeline";
import { partitionTurns } from "../../src/renderer/components/workbench/Transcript";
import { completedTurnExecutions } from "../../src/renderer/state/turn-execution";

const base = { sessionId: "11111111-1111-4111-8111-111111111111", timestamp: "2026-01-01T00:00:00Z", turn: 1 };
const call = { id: "read", type: "function", function: { name: "read_file", arguments: '{"path":"main.ts"}' } };
const snapshot = sessionSnapshotSchema.parse({
  version: 1, id: base.sessionId, title: "执行步数", workspace: "/tmp", model: "fixture", status: "completed",
  createdAt: base.timestamp, updatedAt: "2026-01-01T00:00:10Z", changes: [],
  messages: [
    { role: "user", content: "检查工具调用和重试记录" },
    { role: "assistant", content: "先读取文件。", tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, content: "file content" },
    { role: "user", content: "也检查失败情况" },
    { role: "assistant", content: "检查完成，失败情况已保留在执行记录中。" },
  ],
  events: [
    { ...base, type: "run_started", messageIndex: 0, model: "fixture", permission: "readonly" },
    { ...base, type: "step_started", step: 1, messageIndex: 1 },
    { ...base, type: "tool_started", step: 1, call },
    { ...base, type: "tool_finished", step: 1, toolCallId: call.id, result: { content: "file content", isError: false } },
    { ...base, type: "step_finished", step: 1, messageIndex: 3, status: "completed" },
    { ...base, type: "step_started", step: 2, messageIndex: 4 },
    { ...base, type: "provider_retry", step: 2, attempt: 1, maxAttempts: 5, reason: "network" },
    { ...base, type: "step_finished", step: 2, messageIndex: 5, status: "completed" },
    { ...base, type: "run_finished", timestamp: "2026-01-01T00:00:10Z", messageIndex: 5, status: "completed", turns: 2, steps: 2, toolCalls: 1, retries: 1 },
  ],
});

it("uses recorded turn boundaries for steering, tool grouping and completed reply folding", () => {
  const turns = partitionTurns(reduceTimeline(snapshot));
  expect(turns).toHaveLength(1);
  expect(turns[0]?.items.some(({ item }) => item.kind === "message" && item.content === "也检查失败情况")).toBe(true);
  expect(executionTurns(snapshot)[0]).toMatchObject({ turn: 1, steps: 2, toolCalls: 1, retries: 1 });
  expect(completedTurnExecutions(snapshot)[0]?.finalMessageId).toBe("message:4");
});

it("keeps legacy counts but does not invent retry counts or event matches", () => {
  const legacy = sessionSnapshotSchema.parse({ ...snapshot,
    messages: [snapshot.messages[0], snapshot.messages[4]],
    events: [
      { type: "run_started", sessionId: base.sessionId, timestamp: base.timestamp, model: "fixture", permission: "readonly" },
      { type: "run_finished", sessionId: base.sessionId, timestamp: base.timestamp, status: "completed", turns: 4, toolCalls: 3 },
    ],
  });
  expect(executionTurns(legacy)[0]).toMatchObject({ turn: 1, steps: 4, toolCalls: 3, retries: undefined });
  expect(executionTurns({ ...legacy, events: [] })[0]).toMatchObject({ steps: undefined, toolCalls: undefined });
});

it("keeps new run counts after unmatched legacy history", () => {
  const mixed = sessionSnapshotSchema.parse({ ...snapshot,
    messages: [snapshot.messages[0], snapshot.messages[4], ...snapshot.messages],
    events: snapshot.events.map(event => ({ ...event, turn: 2,
      ...("messageIndex" in event && event.messageIndex !== undefined ? { messageIndex: event.messageIndex + 2 } : {}),
    })),
  });
  expect(executionTurns(mixed).map(turn => [turn.turn, turn.steps])).toEqual([[1, undefined], [2, 2]]);
  expect(partitionTurns(reduceTimeline(mixed))).toHaveLength(2);
});

it("renders live step counts, persisted retries and independent folding at desktop and phone widths", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {StoredTranscript} from './src/renderer/components/workbench/Transcript';
      import './src/renderer/styles/global.css';
      import './src/renderer/styles/workspace-theme.css';
      import './src/renderer/components/workbench/workbench.css';
      import './src/renderer/components/workbench/app.css';
      const done=${JSON.stringify(snapshot)};
      function Harness(){
        const [value,setValue]=useState({...done,status:'running',messages:done.messages.slice(0,4),events:done.events.slice(0,7)});
        return <><button onClick={()=>setValue(done)}>完成</button><div className="wb-app" style={{height:'auto'}}><main className="transcript" style={{width:'100%',maxWidth:760,padding:16,margin:'auto'}}><StoredTranscript snapshot={value}/></main></div></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    ` }, bundle: true, write: false, format: "iife", jsx: "automatic", outfile: "execution.js",
    loader: { ".woff2": "dataurl" }, define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"));
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"));
  if (!js || !css) throw new Error("Missing browser assets");
  const artifacts = process.env.FORGE_QA_DIR ?? await mkdtemp(join(tmpdir(), "forge-step-browser-"));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1280, 390]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        page.setDefaultTimeout(3000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.setContent(`<html data-theme="${theme}"><body><div id="root"></div></body></html>`);
        await page.addStyleTag({ content: css.text });
        await page.addScriptTag({ content: js.text });
        await page.getByText("进行到第 2 步 · 1 次工具调用 · 1 次请求重试", { exact: true }).waitFor();
        expect(await page.locator(".transcript-turn").count()).toBe(1);
        await page.getByRole("button", { name: "完成", exact: true }).click();
        await page.getByText("2 步 · 1 次工具调用 · 1 次请求重试", { exact: true }).waitFor();
        const toggle = page.getByRole("button", { name: "展开本轮执行过程", exact: true });
        await toggle.click();
        expect(await page.getByText("也检查失败情况", { exact: true }).isVisible()).toBe(true);
        // Assert actual process contents rather than a nonexistent step wrapper.
        expect(await page.locator(".transcript-execution-items .tool-disclosure").count()).toBe(1);
        expect(await page.locator(".transcript-execution-items").innerText()).toContain("先读取文件。");
        await page.getByRole("button", { name: "收起第 1 轮对话", exact: true }).click();
        await page.getByRole("button", { name: "展开第 1 轮执行与回复", exact: true }).click();
        await page.getByRole("button", { name: "展开本轮执行过程", exact: true }).click();
        expect(await page.locator(".tool-disclosure").isVisible()).toBe(true);
        await expect.poll(() => page.locator(".tool-disclosure").evaluate(node => getComputedStyle(node).opacity)).toBe("1");
        expect(await page.locator(".transcript-turn-body > .message-assistant").innerText()).toContain("检查完成，失败情况已保留在执行记录中。");
        expect(await page.locator(".transcript-execution-items").innerText()).not.toContain("检查完成，失败情况已保留在执行记录中。");
        await page.screenshot({ path: join(artifacts, `steps-${width}-${theme}.png`), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    if (!process.env.FORGE_QA_DIR) await rm(artifacts, { recursive: true, force: true });
  }
}, 30000);
