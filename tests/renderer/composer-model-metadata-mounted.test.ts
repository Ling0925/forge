import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { defaultPublicSettings } from "../../src/shared/schemas";

/**
 * Browser regression coverage for the composer's model metadata pipeline.
 *
 * These tests deliberately mount the real WorkbenchProvider and Composer rather
 * than the ModelPicker in isolation. They mock only the host bridge so source
 * catalogs, source revisions and the composer's mounted lifetime are exercised
 * together. The settings bridge is also in-memory: no real FORGE_HOME file is
 * read and no provider endpoint is contacted.
 */

declare global {
  interface Window {
    __updates: Record<string, any>[];
    __access: Record<string, any>[];
    __listModels: string[];
    __served: Record<string, any>;
    __wb: any;
    __saveSourceOverrides: (
      overrides: Record<string, unknown>,
    ) => Promise<unknown>;
    __saveGlobalSettings: (patch: Record<string, unknown>) => Promise<unknown>;
    __selectSession: (id: string) => Promise<void>;
    __releaseCatalog: () => void;
    __delayedCatalogReturned: boolean;
  }
}

type CatalogEntry = Readonly<{
  id: string;
  contextWindowTokens: number | null;
  maxOutputTokens?: number;
  reasoningEfforts?: readonly string[];
}>;

type TestSource = Record<string, unknown> & {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  revision: number;
};

type TestConfig = Readonly<{
  settings: Record<string, unknown>;
  catalogs: Readonly<Record<string, readonly CatalogEntry[]>>;
  staleCatalog?: Readonly<{
    sourceId: string;
    models: readonly CatalogEntry[];
  }>;
  sessions?: readonly Record<string, unknown>[];
  snapshots?: Readonly<Record<string, Record<string, unknown>>>;
  legacyCache?: Readonly<{ key: string; value: string }>;
  isNew?: boolean;
}>;

const entry = (
  id: string,
  contextWindowTokens: number | null,
  extra: Partial<CatalogEntry> = {},
): CatalogEntry => ({ id, contextWindowTokens, ...extra });

const source = (
  id: string,
  label: string,
  overrides: Partial<TestSource> = {},
): TestSource => ({
  id,
  label,
  baseUrl: `https://${id}.test/v1`,
  model: "shared/model",
  apiMode: "chat-completions",
  revision: 1,
  hasApiKey: false,
  ...overrides,
});

const settings = (
  sources: readonly TestSource[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...defaultPublicSettings,
  isConfigured: true,
  baseUrl: sources[0]?.baseUrl ?? "https://a.test/v1",
  model: sources[0]?.model ?? "shared/model",
  activeSourceId: sources[0]?.id,
  providerSources: sources,
  ...overrides,
});

const contextEvent = (sessionId: string) => ({
  sessionId,
  timestamp: "2026-01-01T00:01:00.000Z",
  type: "context_usage",
  usage: {
    promptTokens: 11000,
    completionTokens: 1000,
    usedTokens: 12000,
    windowTokens: 50000,
    estimated: false,
    basis: "request",
    parts: {
      instructions: 1000,
      memory: 0,
      conversation: 10000,
      tools: 0,
    },
  },
});

const finishedEvent = (sessionId: string) => ({
  sessionId,
  timestamp: "2026-01-01T00:02:00.000Z",
  type: "run_finished",
  status: "completed",
  turns: 1,
  toolCalls: 0,
  usage: {
    promptTokens: 11000,
    completionTokens: 1000,
    totalTokens: 12000,
  },
  usageComplete: true,
});

const fixtureSnapshot = (
  id: string,
  status: "completed" | "running" | "awaiting_approval",
): Record<string, unknown> => ({
  version: 1,
  id,
  title: id,
  workspace: "/tmp/forge-composer-metadata",
  model: "shared/model",
  providerSourceId: "a",
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:02:00.000Z",
  messages: [
    { role: "user", content: "检查上下文窗口。" },
    { role: "assistant", content: "已检查。" },
  ],
  events:
    status === "completed"
      ? [contextEvent(id), finishedEvent(id)]
      : [contextEvent(id)],
  changes: [],
});

const fixtureSummary = (id: string, status: "completed" | "running" | "awaiting_approval") => ({
  version: 1,
  id,
  title: id,
  workspace: "/tmp/forge-composer-metadata",
  model: "shared/model",
  providerSourceId: "a",
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:02:00.000Z",
});

/**
 * Builds a browser bundle around the real provider. The host mock keeps all
 * state inside the page and records bridge/settings calls for assertions.
 */
const harness = (config: TestConfig): string => `
  import {createRoot} from 'react-dom/client';
  import {useEffect, useRef} from 'react';
  import {Composer} from './src/renderer/components/workbench/Composer';
  import {WorkbenchProvider, useWorkbench} from './src/renderer/state/workbench-context';
  import {defaultPublicSettings} from './src/shared/schemas';

  const config = ${JSON.stringify(config)};
  const clone = value => value === undefined ? undefined : structuredClone(value);
  let settings = clone(config.settings);
  const updates = [];
  const access = [];
  const listModelCalls = [];
  const served = {};
  let staleServed = false;
  let listener = () => {};

  window.__updates = updates;
  window.__access = access;
  window.__listModels = listModelCalls;
  window.__served = served;

  window.forge = {
    getSettings: async () => clone(settings),
    updateSettings: async input => {
      updates.push(clone(input));
      if (input.source) {
        const operation = input.source;
        if (operation.type === 'save') {
          const prior = settings.providerSources.find(item => item.id === operation.source.id);
          if (operation.expectedRevision !== undefined &&
              (prior?.revision ?? 0) !== operation.expectedRevision)
            throw new Error('settings revision conflict');
          const saved = {
            ...prior,
            ...clone(operation.source),
            revision: (prior?.revision ?? 0) + 1,
          };
          settings = {
            ...settings,
            providerSources: [
              ...settings.providerSources.filter(item => item.id !== saved.id),
              saved,
            ],
          };
          return clone(settings);
        }
        if (operation.type === 'activate') {
          settings = {...settings, activeSourceId: operation.id};
          return clone(settings);
        }
        throw new Error('unexpected source operation');
      }
      if (input.settings) {
        settings = {...settings, ...clone(input.settings)};
        return clone(settings);
      }
      throw new Error('unexpected settings patch');
    },
    modelAccess: async input => {
      access.push(clone(input));
      if (input.type !== 'catalog')
        throw new Error('unexpected model access ' + input.type);
      const stale = config.staleCatalog;
      if (stale && input.sourceId === stale.sourceId && !staleServed) {
        staleServed = true;
        await new Promise(resolve => { window.__releaseCatalog = resolve; });
        window.__delayedCatalogReturned = true;
        return {
          type: 'catalog',
          sourceId: input.sourceId,
          models: clone(stale.models),
          fetchedAt: '2026-01-01T00:00:00.000Z',
        };
      }
      return {
        type: 'catalog',
        sourceId: input.sourceId,
        models: clone(config.catalogs[input.sourceId] ?? []),
        fetchedAt: '2026-01-01T00:00:00.000Z',
      };
    },
    // Legacy fallback only. A bridge with modelAccess must not use this path.
    listModels: async sourceId => {
      listModelCalls.push(sourceId);
      return (config.catalogs[sourceId] ?? []).map(item => item.id);
    },
    listSessions: async () => clone(config.sessions ?? []),
    getSession: async id => {
      const snapshot = clone(config.snapshots?.[id]);
      if (snapshot) served[id] = snapshot;
      return snapshot;
    },
    onEvent: callback => {
      listener = callback;
      return () => { listener = () => {}; };
    },
    chooseWorkspace: async () => '/tmp/forge-composer-metadata',
    createSession: async input => ({
      ...(clone(config.snapshots?.[Object.keys(config.snapshots ?? {})[0] ?? '']) ?? {}),
      id: '11111111-1111-4111-8111-111111111111',
      title: 'new session',
      workspace: input.workspace,
      model: input.model ?? 'shared/model',
      providerSourceId: input.providerSourceId,
      status: 'idle',
      messages: [],
      events: [],
      changes: [],
      version: 1,
    }),
    startRun: async input => ({
      runId: '22222222-2222-4222-8222-222222222222',
      sessionId: input.sessionId,
    }),
  };

  function Harness() {
    const wb = useWorkbench();
    const latest = useRef(wb);
    latest.current = wb;
    useEffect(() => {
      window.__wb = latest.current;
      window.__saveSourceOverrides = async overrides => {
        const current = latest.current;
        const source = current.state.settings.providerSources.find(item => item.id === 'a');
        const {
          hasApiKey: _hasApiKey,
          credentials: _credentials,
          connection: _connection,
          revision,
          ...fields
        } = source;
        return current.updateSettings({
          source: {
            type: 'save',
            expectedRevision: revision,
            source: {
              ...fields,
              modelSelection: {
                ...source.modelSelection,
                mode: source.modelSelection?.mode ?? 'all',
                overrides,
              },
            },
          },
        });
      };
      window.__saveGlobalSettings = patch => latest.current.updateSettings({settings: patch});
      window.__selectSession = id => latest.current.selectSession(id);
    }, [wb]);
    return (
      <div className="wb-app" style={{paddingTop: '200px'}}>
        <Composer isNew={config.isNew !== false} />
      </div>
    );
  }

  createRoot(document.getElementById('root')).render(
    <WorkbenchProvider><Harness /></WorkbenchProvider>
  );
`;

const openComposer = async (config: TestConfig) => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: harness(config),
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "composer-model-metadata.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  await page.route("https://forge.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto("https://forge.test/");
  if (config.legacyCache)
    await page.evaluate(
      ({ key, value }) => window.localStorage.setItem(key, value),
      config.legacyCache,
    );
  await page.addStyleTag({
    content:
      bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "",
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text,
  });
  try {
    await page.locator("textarea.composer-textarea").waitFor();
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${pageErrors.join("\n")}`,
    );
  }
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __wb?: { state?: { settings?: unknown } } })
          .__wb?.state?.settings,
      ),
  );
  return { browser, page };
};

const footer = (page: import("playwright").Page) =>
  page.locator(".usage-footer-total");

const title = (page: import("playwright").Page) =>
  page.locator(".composer-model-summary").getAttribute("title");

const pickModel = async (
  page: import("playwright").Page,
  sourceLabel: string,
  modelId: string,
) => {
  if ((await page.locator(".composer-model-panel").count()) === 0)
    await page.locator(".composer-model-summary").click();
  if ((await page.locator(".model-catalog").count()) === 0)
    await page.getByRole("button", { name: /^选择模型：/ }).click();
  const group = page.getByRole("group", { name: sourceLabel, exact: true });
  await group.getByRole("button", { name: new RegExp(modelId.replace("/", "\\/")) }).click();
};

it("reads complete catalog metadata for the active source and follows source selection", async () => {
  const a = entry("shared/model", 128000, {
    maxOutputTokens: 8192,
    reasoningEfforts: ["low", "medium", "high"],
  });
  const b = entry("shared/model", 250000, {
    maxOutputTokens: 16384,
    reasoningEfforts: ["low", "medium", "high"],
  });
  const { browser, page } = await openComposer({
    settings: settings([
      source("a", "Source A"),
      source("b", "Source B"),
    ]),
    catalogs: { a: [a], b: [b] },
  });
  try {
    // The composer must use modelAccess rather than the legacy ID-only bridge.
    await expect.poll(() => page.evaluate(() => window.__access.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__listModels.length)).toBe(0);

    // A fresh composer has no usage events, but the selected source/model still
    // exposes its catalog window.
    await expect.poll(() => title(page)).toContain("Source A");
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("128K");

    // Global modelContextWindows is the highest-priority immediate override.
    await page.evaluate(() => window.__saveGlobalSettings({ modelContextWindows: { "shared/model": 96000 } }));
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("96K");
    await page.evaluate(() => window.__saveGlobalSettings({ modelContextWindows: {} }));
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("128K");

    // The same model ID under source B must use B's catalog window, not A's.
    await pickModel(page, "Source B", "shared/model");
    await expect.poll(() => title(page)).toContain("Source B");
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("250K");
  } finally {
    await browser.close();
  }
}, 30000);

it("updates a mounted composer from source overrides by revision and ignores stale caches", async () => {
  const staleId = JSON.stringify([
    "a",
    "https://a.test/v1",
    "chat-completions",
    false,
  ]);
  const current = entry("shared/model", 128000, {
    maxOutputTokens: 8192,
    reasoningEfforts: ["low", "medium", "high"],
  });
  const stale = [
    entry("shared/model", 900000, { maxOutputTokens: 8192 }),
    entry("stale/v1-only", 700000),
  ];
  const { browser, page } = await openComposer({
    settings: settings([source("a", "Source A"), source("b", "Source B")]),
    catalogs: {
      a: [current],
      b: [entry("shared/model", 250000)],
    },
    staleCatalog: { sourceId: "a", models: stale },
    legacyCache: {
      key: "forge-model-catalog-v1",
      value: JSON.stringify([{ source: staleId, models: ["stale/v1-only"] }]),
    },
  });
  try {
    const input = page.locator("textarea.composer-textarea");
    await input.fill("mounted draft");
    await expect
      .poll(() => page.evaluate(() => window.__access.filter((item) => item.sourceId === "a").length))
      .toBeGreaterThan(0);

    // Save a source override while the first (stale) catalog request is still
    // pending. Revision 2 must win and the already-mounted composer updates.
    await page.evaluate(() =>
      window.__saveSourceOverrides({
        "shared/model": { contextWindowTokens: 64000, maxOutputTokens: 4096 },
      }),
    );
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("64K");
    expect(await input.inputValue()).toBe("mounted draft");

    // Let the old revision's delayed response resolve. It must not replace the
    // revision-2 catalog or resurrect the old ID-only cache.
    await page.evaluate(() => window.__releaseCatalog());
    await expect.poll(() => page.evaluate(() => window.__delayedCatalogReturned)).toBe(true);
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("64K");
    await page.locator(".composer-model-summary").click();
    await page.getByRole("button", { name: /^选择模型：/ }).click();
    const text = await page.locator(".model-catalog-list").innerText();
    expect(text).not.toContain("stale/v1-only");
    expect(text).toContain("shared/model");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // Clearing the source override returns to the current catalog value. A
    // stale revision must not have overwritten that catalog in the meantime.
    await page.evaluate(() => window.__saveSourceOverrides({}));
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("128K");
    expect(await input.inputValue()).toBe("mounted draft");
  } finally {
    await browser.close();
  }
}, 30000);

it("limits reasoning choices to model metadata and saves only the selected model override", async () => {
  const a = source("a", "Source A", {
    modelSelection: {
      mode: "all",
      overrides: {
        "shared/model": {
          contextWindowTokens: 64000,
          maxOutputTokens: 4096,
          reasoningEffort: "high",
        },
        "upstream/model": { reasoningEffort: "medium" },
      },
    },
    modelAliases: { "shared/model": "upstream/model" },
  });
  const { browser, page } = await openComposer({
    settings: settings([a, source("b", "Source B")], {
      reasoningEffort: "low",
    }),
    catalogs: {
      a: [
        entry("shared/model", 128000, {
          maxOutputTokens: 8192,
          reasoningEfforts: ["low", "medium", "high"],
        }),
      ],
      b: [entry("shared/model", 250000)],
    },
  });
  try {
    // Source/model override > alias target override > global settings.
    await expect.poll(() => title(page)).toContain("思考：high");
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("64K");
    const input = page.locator("textarea.composer-textarea");
    await input.fill("reasoning draft");

    await page.locator(".composer-model-summary").click();
    const slider = page.getByRole("slider", { name: "思考等级", exact: true });
    await slider.waitFor();
    expect(await page.locator(".effort-slider-labels > span").allTextContents()).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(await slider.getAttribute("max")).toBe("2");
    expect(await slider.getAttribute("aria-valuetext")).toBe("high");

    // Saving a level updates only this source/model's override. The existing
    // window/output fields and the alias target's override remain intact.
    await slider.press("Home");
    await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
    await expect.poll(() => title(page)).toContain("思考：low");
    const update = await page.evaluate(() => window.__updates[0]);
    if (!update) throw new Error("Expected a source/model effort update");
    expect(update.source).toMatchObject({
      type: "save",
      expectedRevision: 1,
      source: { id: "a" },
    });
    expect(update.source.source.modelSelection.overrides["shared/model"]).toEqual({
      contextWindowTokens: 64000,
      maxOutputTokens: 4096,
      reasoningEffort: "low",
    });
    expect(update.source.source.modelSelection.overrides["upstream/model"]).toEqual({
      reasoningEffort: "medium",
    });
    expect(await input.inputValue()).toBe("reasoning draft");
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("64K");

    // Removing the selected model override falls back to the alias target's
    // override, not the global setting.
    await page.evaluate(() => window.__saveSourceOverrides({ "upstream/model": { reasoningEffort: "medium" } }));
    await expect.poll(() => title(page)).toContain("思考：medium");
    if ((await page.locator(".composer-model-panel").count()) === 0)
      await page.locator(".composer-model-summary").click();
    if ((await page.locator(".model-catalog").count()) > 0)
      await page.getByRole("button", { name: "返回模型设置" }).click();
    const panelSlider = page.getByRole("slider", { name: "思考等级", exact: true });
    await panelSlider.waitFor();
    expect(await panelSlider.getAttribute("aria-valuetext")).toBe("medium");

    // Clearing all overrides falls back to the global level while the composer
    // remains mounted and its draft survives.
    await page.evaluate(() => window.__saveSourceOverrides({}));
    await expect.poll(() => title(page)).toContain("思考：low");
    expect(await input.inputValue()).toBe("reasoning draft");
  } finally {
    await browser.close();
  }
}, 30000);

it.each(["default", "none", "minimal", "xhigh", "max"] as const)("shows configured effort %s even when the catalog omits it, without rewriting it on blur", async (effort) => {
  const label = effort === "max" ? "MAX" : effort;
  const { browser, page } = await openComposer({
    settings: settings([source("a", "Source A", {
      modelSelection: { mode: "all", overrides: { "shared/model": { reasoningEffort: effort } } },
    })], { reasoningEffort: "high" }),
    catalogs: { a: [entry("shared/model", 128000, { reasoningEfforts: ["low", "medium", "high"] })] },
  });
  try {
    await expect.poll(() => title(page)).toContain(`思考：${label}`);
    await page.locator(".composer-model-summary").click();
    const slider = page.getByRole("slider", { name: "思考等级", exact: true });
    await expect.poll(() => slider.getAttribute("aria-valuetext")).toBe(label);
    expect(await page.locator(".effort-slider-heading output").textContent()).toBe(label);
    expect(await page.locator(".effort-slider-labels [data-active=true]").textContent()).toBe(label);
    await slider.focus();
    await page.locator("textarea.composer-textarea").click();
    expect(await page.evaluate(() => window.__updates)).toEqual([]);
    expect(await title(page)).toContain(`思考：${label}`);
  } finally {
    await browser.close();
  }
}, 30000);

it("follows configured efforts across sources and settings revisions even outside advertised choices", async () => {
  const { browser, page } = await openComposer({
    settings: settings([
      source("a", "Source A", {
        modelSelection: { mode: "all", overrides: { "shared/model": { reasoningEffort: "max" } } },
      }),
      source("b", "Source B", {
        modelSelection: { mode: "all", overrides: { "shared/model": { reasoningEffort: "minimal" } } },
      }),
    ], { reasoningEffort: "high" }),
    catalogs: {
      a: [entry("shared/model", 128000, { reasoningEfforts: ["low", "high"] })],
      b: [entry("shared/model", 128000, { reasoningEfforts: ["low", "high"] })],
    },
  });
  try {
    await expect.poll(() => title(page)).toContain("思考：MAX");
    await pickModel(page, "Source B", "shared/model");
    const slider = page.getByRole("slider", { name: "思考等级", exact: true });
    await expect.poll(() => slider.getAttribute("aria-valuetext")).toBe("minimal");
    expect(await title(page)).toContain("思考：minimal");

    await page.evaluate(() => window.__saveSourceOverrides({ "shared/model": { reasoningEffort: "none" } }));
    expect(await title(page)).toContain("思考：minimal");
    await pickModel(page, "Source A", "shared/model");
    await expect.poll(() => slider.getAttribute("aria-valuetext")).toBe("none");

    // Both values have the first index; an unchanged index must not keep an old label.
    await page.evaluate(() => window.__saveSourceOverrides({ "shared/model": { reasoningEffort: "minimal" } }));
    await expect.poll(() => slider.getAttribute("aria-valuetext")).toBe("minimal");
    await page.evaluate(() => window.__saveSourceOverrides({}));
    await expect.poll(() => slider.getAttribute("aria-valuetext")).toBe("high");
    expect(await title(page)).toContain("思考：high");
    expect(await page.evaluate(() => window.__updates.length)).toBe(3);
  } finally {
    await browser.close();
  }
}, 30000);

it("does not revive a historical override after clearing an unknown model's current window", async () => {
  const idle = fixtureSnapshot("idle-session", "completed");
  const { browser, page } = await openComposer({
    isNew: false,
    settings: settings([source("a", "Source A", {
      modelSelection: { mode: "all", overrides: { "shared/model": { contextWindowTokens: 256000 } } },
    })]),
    catalogs: { a: [entry("shared/model", null)] },
    sessions: [fixtureSummary("idle-session", "completed")],
    snapshots: { "idle-session": idle },
  });
  try {
    await page.evaluate(() => window.__selectSession("idle-session"));
    await expect.poll(() => footer(page).innerText()).toBe("256K");
    await page.evaluate(() => window.__saveSourceOverrides({}));
    // The host's unknown-model fallback is 300K, not this event's old 50K.
    await expect.poll(() => footer(page).innerText()).toBe("300K");
    await page.locator(".composer-usage > summary").click();
    await expect.poll(() => page.locator(".usage-panel").innerText()).toContain("12K");
    expect(await page.evaluate(() => window.__served["idle-session"].events[0].usage.windowTokens)).toBe(50000);
  } finally {
    await browser.close();
  }
}, 30000);

it.each(["running", "awaiting_approval"] as const)("keeps captured windows and usage totals for %s fixtures while idle views follow current metadata", async (activeStatus) => {
  const idle = fixtureSnapshot("idle-session", "completed");
  const running = fixtureSnapshot("running-session", activeStatus);
  const { browser, page } = await openComposer({
    isNew: false,
    settings: settings(
      [
        source("a", "Source A", {
          modelSelection: {
            mode: "all",
            overrides: { "shared/model": { contextWindowTokens: 64000 } },
          },
        }),
        source("b", "Source B"),
      ],
      { modelContextWindows: {} },
    ),
    catalogs: { a: [entry("shared/model", 128000)], b: [entry("shared/model", 250000)] },
    sessions: [fixtureSummary("idle-session", "completed"), fixtureSummary("running-session", activeStatus)],
    snapshots: { "idle-session": idle, "running-session": running },
  });
  try {
    // Historical idle view follows the current source window, not the window
    // captured in its old event.
    await page.evaluate(() => window.__selectSession("idle-session"));
    await expect.poll(() => title(page)).toContain("shared/model");
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("64K");
    await page.locator(".composer-usage > summary").click();
    await expect.poll(() => page.locator(".usage-panel").innerText()).toContain("12K");
    const servedIdle = await page.evaluate(() => JSON.stringify(window.__served["idle-session"]));
    await page.keyboard.press("Escape");

    // An active run keeps the captured event window even when source metadata
    // changes underneath it.
    await page.evaluate(() => window.__selectSession("running-session"));
    await expect.poll(() => title(page)).toContain("shared/model");
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("50K");
    await page.locator(".composer-usage > summary").click();
    await expect.poll(() => page.locator(".usage-panel").innerText()).toContain("12K");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__saveSourceOverrides({ "shared/model": { contextWindowTokens: 96000 } }));
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("50K");
    expect(await page.evaluate(() => JSON.stringify(window.__served["running-session"]))).toContain(
      '"windowTokens":50000',
    );

    // Returning to the idle fixture applies the new current window, while the
    // captured usage totals and fixture events remain unchanged.
    await page.evaluate(() => window.__selectSession("idle-session"));
    await expect.poll(async () => (await footer(page).innerText()).trim()).toBe("96K");
    await page.locator(".composer-usage > summary").click();
    await expect.poll(() => page.locator(".usage-panel").innerText()).toContain("12K");
    expect(await page.evaluate(() => JSON.stringify(window.__served["idle-session"]))).toBe(servedIdle);
  } finally {
    await browser.close();
  }
}, 30000);
