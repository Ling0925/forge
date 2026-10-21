import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import type { SessionSnapshot } from "../../src/renderer/shared-types";
import { createPersistentUsageCache } from "../../src/renderer/state/persistent-usage-cache";
import {
  appendSessionEvent,
  seedSessionUsage,
  sessionUsage,
} from "../../src/renderer/state/session-usage";
import {
  type AgentEvent,
  agentEventSchema,
  parseSessionId,
  sessionSnapshotSchema,
} from "../../src/shared/schemas";
import type { SessionPageInfo } from "../../src/shared/session-page";
import {
  sessionUsageStateSchema,
  summarizeUsageState,
} from "../../src/shared/session-usage";

type AttemptEvent = Extract<AgentEvent, { type: "provider_attempt" }>;
const id = parseSessionId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const stamp = (seconds: number) =>
  new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const start = (seconds: number) =>
  agentEventSchema.parse({
    type: "run_started",
    sessionId: id,
    timestamp: stamp(seconds),
    model: "test",
    permission: "readonly",
  });
const finish = (
  seconds: number,
  promptTokens: number,
  completionTokens: number,
) =>
  agentEventSchema.parse({
    type: "run_finished",
    sessionId: id,
    timestamp: stamp(seconds),
    status: "completed",
    turns: 1,
    toolCalls: 0,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    usageComplete: true,
  });
const attempt = (
  seconds: number,
  outcome: AttemptEvent["selection"]["outcome"],
  completionTokens?: number,
): AttemptEvent =>
  agentEventSchema.parse({
    type: "provider_attempt",
    sessionId: id,
    timestamp: stamp(seconds),
    selection: {
      sourceId: "test",
      model: "test",
      apiMode: "responses",
      attempt: 0,
      reason: "direct",
      outcome,
      timestamp: stamp(seconds),
      ...(completionTokens === undefined
        ? {}
        : {
            usage: {
              promptTokens: 100,
              completionTokens,
              totalTokens: 100 + completionTokens,
            },
          }),
    },
  }) as AttemptEvent;
const report = (
  seconds: number,
  promptTokens: number,
  cachedPromptTokens?: number,
) =>
  agentEventSchema.parse({
    type: "context_usage",
    sessionId: id,
    timestamp: stamp(seconds),
    usage: {
      basis: "request-with-output",
      estimated: false,
      windowTokens: 100000,
      usedTokens: promptTokens + 10,
      promptTokens,
      completionTokens: 10,
      ...(cachedPromptTokens === undefined ? {} : { cachedPromptTokens }),
      parts: {
        instructions: 0,
        memory: 0,
        conversation: promptTokens + 10,
        tools: 0,
      },
    },
  });

// The split falls between a request start and its completion, so the seed must
// carry request timing as well as totals/cache/context display state.
const all = [
  start(0),
  attempt(1, "started"),
  report(2, 1000, 900),
  attempt(3, "succeeded", 40),
  finish(4, 100, 40),
  start(10),
  attempt(11, "started"),
  report(12, 2000, 1000),
  attempt(13, "succeeded", 60),
  finish(14, 200, 60),
];
const split = 7;
const page = all.slice(split);
const before = summarizeUsageState(all.slice(0, split));

it("seeds a page from its fixed-size prefix and matches the full session summary", () => {
  expect(sessionUsageStateSchema.parse(before)).toEqual(before);
  // A page-only scan is replaced by the prefix-aware summary.
  expect(sessionUsage(page).total?.totalTokens).toBe(260);
  seedSessionUsage(page, before);
  expect(sessionUsage(page)).toEqual(sessionUsage(all));
  expect(sessionUsage(page).speed).toMatchObject({
    outputTokens: 100,
    durationMs: 4000,
    partial: false,
  });

  const extra = report(20, 3000, 1500);
  const appended = appendSessionEvent(page, extra);
  expect(sessionUsage(appended)).toEqual(sessionUsage([...all, extra]));

  const latest = all.slice(split);
  seedSessionUsage(latest, before);
  const older = all.slice(5, split);
  const merged = [...older, ...latest];
  // The merged array may already have a page-only cache entry. Seeding it with
  // the new prefix must replace that entry with the same result as a full scan.
  expect(sessionUsage(merged).total?.totalTokens).toBe(260);
  seedSessionUsage(merged, summarizeUsageState(all.slice(0, 5)));
  expect(sessionUsage(merged)).toEqual(sessionUsage(all));
});

it("does not rescan a page when it is seeded again with the same prefix reference", () => {
  let reads = 0;
  const events = new Proxy(all.slice(split), {
    get(target, key, receiver) {
      if (typeof key === "string") reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  seedSessionUsage(events, before);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  seedSessionUsage(events, before);
  expect(reads).toBe(0);
});

it("keeps large tool bodies out of the seed state", () => {
  const secret = "TOOL_BODY_MUST_NOT_LEAK";
  const tool = agentEventSchema.parse({
    type: "tool_finished",
    sessionId: id,
    timestamp: stamp(5),
    toolCallId: "call-1",
    result: { content: secret.repeat(4000), isError: false },
  });
  const seed = summarizeUsageState([...all.slice(0, split), tool]);
  const serialized = JSON.stringify(seed);
  expect(serialized).not.toContain(secret);
  expect(serialized.length).toBeLessThan(10000);
  expect(sessionUsageStateSchema.parse(seed)).toEqual(seed);
});

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

it("persists a paged full summary without mixing page length or overwriting newer totals", () => {
  const fullSnapshot = sessionSnapshotSchema.parse({
    version: 1,
    id,
    title: "paged",
    workspace: "/tmp/paged",
    model: "test",
    createdAt: stamp(0),
    updatedAt: stamp(14),
    status: "completed",
    messages: [],
    changes: [],
    events: all,
  });
  const transcript: SessionPageInfo = {
    messageOffset: 0,
    eventOffset: split,
    messageEnd: 0,
    eventEnd: all.length,
    totalMessages: 0,
    firstTurn: 2,
    hasMore: true,
    usageBefore: before,
  };
  const pagedSnapshot: SessionSnapshot = {
    ...fullSnapshot,
    events: all.slice(split),
    transcript,
  };
  const disk = storage();
  const cache = createPersistentUsageCache(() => disk);
  const paged = cache.snapshot(pagedSnapshot);
  expect(paged.eventCount).toBe(all.length);
  expect(paged.model).toBe("test");
  expect(paged.usage).toEqual(sessionUsage(all));
  expect([...disk.values.values()].join("")).toContain('"eventCount":10');

  // Reopening with the full snapshot reuses the fixed-size full summary rather
  // than replacing it with the shorter page's event count or partial totals.
  const reloaded = createPersistentUsageCache(() => disk);
  expect(reloaded.snapshot(fullSnapshot)).toEqual(paged);

  const saved = [...disk.values.values()].join("");
  const older: SessionSnapshot = {
    ...fullSnapshot,
    events: all.slice(3, split),
    transcript: {
      ...transcript,
      eventOffset: 3,
      eventEnd: split,
      firstTurn: 1,
      usageBefore: summarizeUsageState(all.slice(0, 3)),
    },
  };
  expect(cache.snapshot(older)).toEqual(paged);
  expect([...disk.values.values()].join("")).toBe(saved);
});

it("does not persist a page-only summary when its prefix snapshot is missing", () => {
  const fullSnapshot = sessionSnapshotSchema.parse({
    version: 1,
    id,
    title: "paged",
    workspace: "/tmp/paged",
    model: "test",
    createdAt: stamp(0),
    updatedAt: stamp(14),
    status: "completed",
    messages: [],
    changes: [],
    events: all,
  });
  const { usageBefore: _usageBefore, ...withoutPrefix } = {
    messageOffset: 0,
    eventOffset: split,
    messageEnd: 0,
    eventEnd: all.length,
    totalMessages: 0,
    firstTurn: 2,
    hasMore: true,
    usageBefore: before,
  } satisfies SessionPageInfo;
  const pageOnly: SessionSnapshot = {
    ...fullSnapshot,
    events: all.slice(split),
    transcript: withoutPrefix,
  };
  const disk = storage();
  const cache = createPersistentUsageCache(() => disk);
  const pageOnlyResult = cache.snapshot(pageOnly);
  expect(pageOnlyResult.usage.total?.totalTokens).toBe(260);
  expect(pageOnlyResult.usage.partial).toBe(true);
  expect(cache.get(pageOnly)).toBeUndefined();
  expect([...disk.values.values()]).toEqual([]);

  const complete = cache.snapshot(fullSnapshot);
  expect(complete.usage.total?.totalTokens).toBe(400);
  expect(cache.get(fullSnapshot)?.usage.total?.totalTokens).toBe(400);
});

it("sidebar hover reads one page instead of fetching the full session history", async () => {
  const prefixEvent = agentEventSchema.parse({
    type: "run_finished",
    sessionId: id,
    timestamp: stamp(1),
    status: "completed",
    turns: 1,
    toolCalls: 0,
    usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    usageComplete: true,
  });
  const pageEvent = agentEventSchema.parse({
    type: "run_finished",
    sessionId: id,
    timestamp: stamp(14),
    status: "completed",
    turns: 1,
    toolCalls: 0,
    usage: { promptTokens: 500, completionTokens: 700, totalTokens: 1200 },
    usageComplete: true,
  });
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import {createRoot} from 'react-dom/client';
        import {SessionListItem} from './src/renderer/components/workbench/SessionListItem';
        import './src/renderer/styles/global.css';
        import './src/renderer/components/workbench/workbench.css';
        import './src/renderer/components/workbench/app.css';
        import './src/renderer/styles/workspace-theme.css';
        import './src/renderer/styles/sidebar-compact.css';
        const base={version:1,id:${JSON.stringify(id)},title:'页面摘要',workspace:'/tmp',model:'provider/model-id',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:14.000Z',status:'completed',messages:[],changes:[]};
        const missingId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const missingBase={...base,id:missingId,title:'缺前缀摘要'};
        const pageEvents=${JSON.stringify([pageEvent])};
        const usageBefore=${JSON.stringify(summarizeUsageState([prefixEvent]))};
        window.forge={
          getSessionPage:async id=>{
            document.body.dataset.pages=String(Number(document.body.dataset.pages||0)+1);
            const missing=id===missingId;
            const page={messageOffset:0,eventOffset:1,messageEnd:1,eventEnd:2,totalMessages:1,firstTurn:1,hasMore:true,...(missing?{}:{usageBefore})};
            return {snapshot:{...(missing?missingBase:base),id,events:pageEvents},page};
          },
          getSession:async id=>{
            document.body.dataset.fullReads=String(Number(document.body.dataset.fullReads||0)+1);
            return {...(id===missingId?missingBase:base),events:pageEvents};
          }
        };
        createRoot(document.getElementById('root')).render(<div className="wb-app"><aside className="workbench-sidebar"><SessionListItem session={{...base}}/><SessionListItem session={{...missingBase}}/></aside></div>);
      `,
    },
    plugins: [
      {
        name: "sidebar-paged-state",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            loader: "js",
            contents: `export const useWorkbench=()=>({state:{activeRuns:{},activeSessionId:'${id}',isNewSessionOpen:false},selectSession:()=>{},setMobileSidebar:()=>{}});`,
          }));
        },
      },
    ],
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "sidebar-paged.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )?.text;
  if (!js || !css) throw new Error("Missing sidebar bundle");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });
    const item = page.getByRole("button", { name: "页面摘要", exact: true });
    await item.waitFor();
    await item.hover();
    await page.getByRole("tooltip").getByText("1,500").waitFor();
    expect(await page.locator("body").getAttribute("data-pages")).toBe("1");
    expect(
      await page.locator("body").getAttribute("data-full-reads"),
    ).toBeNull();

    // A page whose prefix summary is missing stays a page-only, partial total;
    // hovering it must not fall back to reading the full transcript.
    const missing = page.getByRole("button", {
      name: "缺前缀摘要",
      exact: true,
    });
    await missing.hover();
    await page.getByRole("tooltip").getByText("1,200（部分统计）").waitFor();
    expect(await page.locator("body").getAttribute("data-pages")).toBe("2");
    expect(
      await page.locator("body").getAttribute("data-full-reads"),
    ).toBeNull();
  } finally {
    await browser.close();
  }
}, 20000);
