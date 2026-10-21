import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { StoredTranscript } from "../../src/renderer/components/workbench/Transcript";
import { completedTurnExecutions } from "../../src/renderer/state/turn-execution";
import { sessionSnapshotSchema, type AgentEvent } from "../../src/shared/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const call = { id: "tool", type: "function" as const,
  function: { name: "run_command", arguments: '{"argv":["git","status"]}' } };
const started: AgentEvent = { type: "run_started", sessionId: id,
  timestamp: "2026-01-01T00:00:00Z", model: "m", permission: "readonly" };
const finished: AgentEvent = { type: "run_finished", sessionId: id,
  timestamp: "2026-01-01T00:00:10Z", status: "completed", turns: 2, toolCalls: 1,
  usage: { promptTokens: 50, completionTokens: 200, totalTokens: 250 } };
const request = (from: string, to: string, completionTokens: number): AgentEvent[] => [
  { type: "provider_attempt", sessionId: id, timestamp: from, selection: {
    sourceId: "test", model: "m", apiMode: "responses", attempt: 0, reason: "direct", outcome: "started", timestamp: from,
  } },
  { type: "provider_attempt", sessionId: id, timestamp: to, selection: {
    sourceId: "test", model: "m", apiMode: "responses", attempt: 0, reason: "direct", outcome: "succeeded", timestamp: to,
    usage: { promptTokens: 25, completionTokens, totalTokens: 25 + completionTokens },
  } },
];
const requests = [
  ...request("2026-01-01T00:00:00Z", "2026-01-01T00:00:02Z", 80),
  ...request("2026-01-01T00:00:08Z", "2026-01-01T00:00:10Z", 120),
]; // Four seconds of requests and six seconds of tool work.
const snapshot = sessionSnapshotSchema.parse({
  version: 1, id, title: "test", workspace: "/tmp", model: "m", status: "completed",
  createdAt: started.timestamp, updatedAt: finished.timestamp,
  messages: [
    { role: "user", content: "Run task" },
    { role: "assistant", content: "Intermediate commentary", tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, content: "command output" },
    { role: "assistant", content: "Final answer" },
  ], events: [started, ...requests, finished], changes: [],
});

describe("completed turn execution", () => {
  it("collapses intermediate messages and commands but preserves the final answer", () => {
    expect(completedTurnExecutions(snapshot)).toEqual([
      { finalMessageId: "message:3", duration: "10.0s", speed: "50 tok/s" },
    ]);
    const html = renderToStaticMarkup(createElement(StoredTranscript, { snapshot }));
    expect(html).toContain("done");
    expect(html).toContain("总耗时 10.0s");
    expect(html).toContain("50 tok/s");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Final answer");
    expect(html).toContain("Run task");
    expect(html).not.toContain("Intermediate commentary");
    expect(html).not.toContain("tool-disclosure");
  });

  it("does not collapse running, failed, cancelled or interrupted runs", () => {
    expect(completedTurnExecutions({ ...snapshot, events: [started] })).toEqual([undefined]);
    for (const status of ["failed", "cancelled", "interrupted"] as const) {
      const current = { ...snapshot, events: [started, { ...finished, status }] };
      expect(completedTurnExecutions(current)).toEqual([undefined]);
      const html = renderToStaticMarkup(createElement(StoredTranscript, { snapshot: current }));
      expect(html).toContain("Intermediate commentary");
      expect(html).toContain("tool-disclosure");
    }
  });

  it("waits for a persisted final answer and never guesses unmatched legacy turns", () => {
    expect(completedTurnExecutions({ ...snapshot, messages: snapshot.messages.slice(0, -1) })).toEqual([undefined]);
    expect(completedTurnExecutions({ ...snapshot, messages: snapshot.messages.slice(0, 2) })).toEqual([undefined]);
    expect(completedTurnExecutions({ ...snapshot, events: [finished] })).toEqual([]);
    expect(completedTurnExecutions({ ...snapshot,
      messages: [...snapshot.messages, { role: "user", content: "Next turn" }] })).toEqual([]);
  });

  it("keeps per-turn metrics separate and excludes idle time and child usage", () => {
    const nextStart = { ...started, timestamp: "2026-01-02T00:00:00Z" };
    const nextFinish = { ...finished, timestamp: "2026-01-02T00:00:20Z",
      usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
      totalUsage: { promptTokens: 500, completionTokens: 1000, totalTokens: 1500 } };
    expect(completedTurnExecutions({ ...snapshot,
      messages: [...snapshot.messages, ...snapshot.messages],
      events: [started, ...requests, finished, nextStart,
        ...request("2026-01-02T00:00:01Z", "2026-01-02T00:00:11Z", 100), nextFinish],
    })).toEqual([
      { finalMessageId: "message:3", duration: "10.0s", speed: "50 tok/s" },
      { finalMessageId: "message:7", duration: "20.0s", speed: "10 tok/s" },
    ]);
  });

  it("shows unavailable and partial metrics honestly", () => {
    const { usage: _usage, ...withoutUsage } = finished;
    expect(completedTurnExecutions({ ...snapshot, events: [started, withoutUsage] })[0]?.speed).toBe("— tok/s");
    expect(completedTurnExecutions({ ...snapshot, events: [started, finished] })[0]?.speed).toBe("— tok/s");
    expect(completedTurnExecutions({ ...snapshot, events: [started, ...requests, withoutUsage] })[0]?.speed).toBe("50 tok/s");
    expect(completedTurnExecutions({ ...snapshot,
      events: [started, ...requests, { ...finished, usageComplete: false }] })[0]?.speed).toBe("≈ 50 tok/s");
    const invalid = completedTurnExecutions({ ...snapshot,
      events: [{ ...started, timestamp: "2026-01-03T00:00:00Z" }, finished] });
    expect(invalid[0]).toMatchObject({ duration: "—", speed: "— tok/s" });
  });
});

it("automatically folds on completion, supports reopening, and isolates turn toggles", async () => {
  const result = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {StoredTranscript} from './src/renderer/components/workbench/Transcript';
      const complete=${JSON.stringify(snapshot)};
      function Harness(){
        const [value,setValue]=useState({...complete,status:'running',events:[complete.events[0]]});
        window.finish=()=>setValue(complete);
        window.next=()=>setValue({...complete,messages:[...complete.messages,...complete.messages],events:[...complete.events,...complete.events]});
        return <StoredTranscript snapshot={value}/>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    ` }, bundle: true, write: false, format: "iife", jsx: "automatic",
    outfile: "turn-execution.js", loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: js });
    const commentary = page.getByText("Intermediate commentary", { exact: true });
    await expect.poll(() => commentary.count()).toBe(1);
    await page.evaluate(() => (window as unknown as { finish(): void }).finish());
    await expect.poll(() => commentary.count()).toBe(0);
    const summary = page.getByRole("button", { name: "展开本轮执行过程", exact: true });
    expect(await summary.innerText()).toContain("50 tok/s");
    expect(await summary.innerText()).toContain("总耗时 10.0s");
    expect(await summary.getAttribute("title")).toContain("请求总耗时");
    expect(await page.getByText("Final answer", { exact: true }).isVisible()).toBe(true);
    await summary.click();
    await expect.poll(() => commentary.count()).toBe(1);
    expect(await page.locator(".tool-disclosure").count()).toBe(1);
    await page.evaluate(() => (window as unknown as { next(): void }).next());
    await expect.poll(() => page.locator(".transcript-execution-summary").count()).toBe(2);
    expect(await page.locator(".transcript-execution-summary").nth(0).getAttribute("aria-expanded")).toBe("true");
    expect(await page.locator(".transcript-execution-summary").nth(1).getAttribute("aria-expanded")).toBe("false");
    expect(await page.getByText("Final answer", { exact: true }).count()).toBe(2);
    await page.locator(".transcript-execution-summary").nth(0).click();
    await expect.poll(() => commentary.count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 20000);
