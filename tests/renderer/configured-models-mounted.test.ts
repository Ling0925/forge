import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";
import { defaultPublicSettings } from "../../src/shared/schemas";

/**
 * Browser regressions for the configured-model picker and the per-model
 * request-protocol editor.
 *
 * The real WorkbenchProvider, Composer and ProviderSources are mounted. Only
 * the host bridge is mocked; all settings, catalogs and revisions live inside
 * the page. No real FORGE_HOME file, credential or provider endpoint is used.
 * Saves go through configureInputSchema so the browser test also covers the
 * public save input round-trip.
 */

declare global {
  interface Window {
    __updates: Record<string, any>[];
    __access: Record<string, any>[];
    __listModels: string[];
    __schemaErrors: string[][];
    __served: Record<string, any>;
    __wb: any;
    __remount: () => void;
    __selectSession: (id: string) => Promise<void>;
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
  apiMode: string;
  revision: number;
};

type TestConfig = Readonly<{
  settings: Record<string, unknown>;
  catalogs: Readonly<Record<string, readonly CatalogEntry[]>>;
  failCatalogs?: readonly string[];
  withSettings?: boolean;
  isNew?: boolean;
  sessions?: readonly Record<string, unknown>[];
  snapshots?: Readonly<Record<string, Record<string, unknown>>>;
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
  model: "shared/default",
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
  model: sources[0]?.model ?? "shared/default",
  activeSourceId: sources[0]?.id,
  providerSources: sources,
  ...overrides,
});

const sessionSummary = (id: string, model: string) => ({
  version: 1,
  id,
  title: id,
  workspace: "/tmp/forge-configured-models",
  model,
  providerSourceId: "a",
  status: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:02:00.000Z",
});

const sessionSnapshot = (id: string, model: string) => ({
  ...sessionSummary(id, model),
  messages: [
    { role: "user", content: "继续。" },
    { role: "assistant", content: "好的。" },
  ],
  events: [],
  changes: [],
});

/**
 * Builds a browser bundle around the real provider. Settings saves are
 * validated with the public configure schema and kept in page memory; a
 * remount rebuilds the React tree without resetting that memory so persisted
 * state is exercised rather than component-local drafts.
 */
const harness = (config: TestConfig): string => `
  import {createRoot} from 'react-dom/client';
  import {useEffect, useRef} from 'react';
  import {Composer} from './src/renderer/components/workbench/Composer';
  import {ProviderSources} from './src/renderer/components/workbench/ProviderSources';
  import {WorkbenchProvider, useWorkbench} from './src/renderer/state/workbench-context';
  import {configureInputSchema} from './src/shared/schemas';
  import './src/renderer/styles/global.css';

  const config = ${JSON.stringify(config)};
  const clone = value => value === undefined ? undefined : structuredClone(value);
  let settings = clone(config.settings);
  const updates = [];
  const access = [];
  const listModelCalls = [];
  const schemaErrors = [];
  const served = {};
  let listener = () => {};

  window.__updates = updates;
  window.__access = access;
  window.__listModels = listModelCalls;
  window.__schemaErrors = schemaErrors;
  window.__served = served;

  const parsedInput = input => {
    const parsed = configureInputSchema.safeParse(input);
    if (!parsed.success) {
      schemaErrors.push(parsed.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message));
      throw new Error('configureInputSchema rejected the save');
    }
    return parsed.data;
  };

  window.forge = {
    getSettings: async () => clone(settings),
    updateSettings: async input => {
      const parsed = parsedInput(input);
      updates.push(clone(parsed));
      const operation = parsed.source;
      if (operation) {
        if (operation.type === 'save') {
          const existing = settings.providerSources ?? [];
          const prior = existing.find(item => item.id === operation.source.id);
          if (operation.expectedRevision !== undefined &&
              (prior?.revision ?? 0) !== operation.expectedRevision)
            throw new Error('settings revision conflict');
          const saved = {
            ...prior,
            ...clone(operation.source),
            hasApiKey: prior?.hasApiKey ?? false,
            revision: (prior?.revision ?? 0) + 1,
          };
          settings = {
            ...settings,
            providerSources: prior
              ? existing.map(item => item.id === saved.id ? saved : item)
              : [...existing, saved],
          };
          return clone(settings);
        }
        if (operation.type === 'activate') {
          settings = {...settings, activeSourceId: operation.id};
          return clone(settings);
        }
        if (operation.type === 'remove') {
          settings = {
            ...settings,
            providerSources: (settings.providerSources ?? [])
              .filter(item => item.id !== operation.id),
          };
          return clone(settings);
        }
        throw new Error('unexpected source operation');
      }
      if (parsed.settings) {
        settings = {...settings, ...clone(parsed.settings)};
        return clone(settings);
      }
      throw new Error('unexpected settings patch');
    },
    modelAccess: async input => {
      access.push(clone(input));
      if (input.type === 'presets') return {type: 'presets', presets: []};
      if (input.type !== 'catalog') throw new Error('unexpected model access ' + input.type);
      if ((config.failCatalogs ?? []).includes(input.sourceId))
        throw new Error('catalog request failed for ' + input.sourceId);
      return {
        type: 'catalog',
        sourceId: input.sourceId,
        models: clone(config.catalogs[input.sourceId] ?? []),
        fetchedAt: '2026-01-01T00:00:00.000Z',
      };
    },
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
    chooseWorkspace: async () => '/tmp/forge-configured-models',
    createSession: async input => ({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'new session',
      workspace: input.workspace,
      model: input.model ?? 'shared/default',
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
      // ProviderSources only fetches catalogs while settings is open, which is
      // how the real settings page mounts it.
      if (!window.__settingsOpened && latest.current.state.settings) {
        window.__settingsOpened = true;
        latest.current.dispatch({type: 'OPEN_SETTINGS', isOpen: true});
      }
    }, [wb]);
    return (
      <div className="wb-app">
        <Composer isNew={config.isNew !== false} />
        {config.withSettings ? <ProviderSources onBusy={() => {}} /> : null}
      </div>
    );
  }

  let root;
  function renderApp() {
    root = createRoot(document.getElementById('root'));
    root.render(<WorkbenchProvider><Harness /></WorkbenchProvider>);
  }
  window.__remount = () => {
    root.unmount();
    window.__settingsOpened = false;
    window.__wb = undefined;
    renderApp();
  };
  window.__selectSession = id => window.__wb.selectSession(id);
  renderApp();
`;

const openApp = async (
  config: TestConfig,
  viewport: { width: number; height: number } = { width: 1280, height: 900 },
) => {
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
    outfile: "configured-models.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({ viewport });
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
  await page.addStyleTag({
    content:
      "html,body,#root{margin:0;padding:0;}" +
      (bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ??
        ""),
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith(".js"))!
      .text,
  });
  try {
    await page.locator("textarea.composer-textarea").waitFor({ state: "attached" });
    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as { __wb?: { state?: { settings?: unknown } } })
          .__wb?.state?.settings,
      ),
    );
  } catch (error) {
    await browser.close();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${pageErrors.join("\n")}`,
    );
  }
  return { browser, page, pageErrors };
};

const remount = async (page: Page) => {
  await page.evaluate(() => window.__remount());
  await page
    .locator("textarea.composer-textarea")
    .waitFor({ state: "attached" });
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __wb?: { state?: { settings?: unknown } } })
        .__wb?.state?.settings,
    ),
  );
};

const openModelCatalog = async (page: Page) => {
  if ((await page.locator(".model-catalog").count()) > 0) return;
  if ((await page.locator(".composer-model-panel").count()) === 0)
    await page.locator(".composer-model-summary").click();
  await page.getByRole("button", { name: /^选择模型：/ }).click();
  await page.locator(".model-catalog").waitFor();
};

const closeModelPanel = async (page: Page) => {
  if ((await page.locator(".composer-model-panel").count()) > 0)
    await page.locator(".composer-model-summary").click();
};

const catalogGroups = (page: Page) =>
  page
    .locator('.model-catalog-list [role="group"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label") ?? "",
        models: Array.from(
          node.querySelectorAll<HTMLButtonElement>(
            "button.model-catalog-option[title]",
          ),
        ).map((button) => button.title),
      })),
    );

const catalogModelTitles = (page: Page) =>
  page
    .locator(".model-catalog-list button.model-catalog-option[title]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("title") ?? ""),
    );

const pickModel = async (page: Page, sourceLabel: string, model: string) => {
  await openModelCatalog(page);
  await page
    .getByRole("group", { name: sourceLabel, exact: true })
    .locator(`button.model-catalog-option[title="${model}"]`)
    .click();
};

const summaryTitle = (page: Page) =>
  page.locator(".composer-model-summary").getAttribute("title");

const modelCard = (page: Page, id: string) =>
  page.getByLabel(`已配置模型卡片 ${id}`, { exact: true });

const protocolSelect = (page: Page, id: string) =>
  page.getByLabel(`模型 ${id} 请求协议`, { exact: true });

const addConfiguredModel = async (
  page: Page,
  sourceLabel: string,
  id: string,
) => {
  const toggle = page.getByRole("button", {
    name: `添加${sourceLabel}的配置模型`,
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  const add = page.getByRole("button", {
    name: `添加模型 ${id} 到配置卡片`,
    exact: true,
  });
  await add.waitFor();
  await add.click();
  await modelCard(page, id).waitFor();
};

const saveSourceModels = async (page: Page, sourceLabel: string) => {
  const index = await page.evaluate(() => window.__updates.length);
  await page
    .getByRole("button", {
      name: `保存${sourceLabel}的模型配置`,
      exact: true,
    })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__updates.length))
    .toBe(index + 1);
  await expect
    .poll(() =>
      page
        .getByRole("button", {
          name: `保存${sourceLabel}的模型配置`,
          exact: true,
        })
        .count(),
    )
    .toBe(0);
  return page.evaluate((at) => window.__updates[at], index);
};

const sourceFields = (update: Record<string, any> | undefined) =>
  update?.source?.source;

it("offers only saved models and keeps source catalogs isolated", async () => {
  const { browser, page, pageErrors } = await openApp({
    settings: settings([
      source("a", "源 A", {
        model: "a/default",
        modelSelection: {
          mode: "all",
          manual: [
            { id: "shared/model", contextWindowTokens: null },
            { id: "a/manual", contextWindowTokens: 32000 },
          ],
          overrides: {
            "a/custom": { apiMode: "responses" },
            "a/empty": {},
          },
        },
      }),
      source("b", "源 B", {
        model: "b/default",
        modelSelection: {
          mode: "selected",
          models: ["b/selected"],
          manual: [{ id: "b/manual", contextWindowTokens: null }],
        },
      }),
      source("c", "源 C", {
        model: "c/default",
        modelSelection: { mode: "none" },
      }),
    ]),
    catalogs: {
      a: [
        entry("a/default", 128000),
        entry("a/upstream-only", 64000),
        entry("shared/model", 256000),
      ],
      b: [
        entry("b/default", 128000),
        entry("b/selected", 256000),
        entry("b/upstream-only", 64000),
        entry("shared/model", 256000),
      ],
      c: [entry("c/default", 128000)],
    },
    failCatalogs: ["b"],
  });
  try {
    await openModelCatalog(page);
    const groups = await catalogGroups(page);
    expect(groups.map((group) => group.label)).toEqual(["源 A", "源 B"]);
    expect(groups[0]?.models).toEqual([
      "a/default",
      "shared/model",
      "a/manual",
      "a/custom",
    ]);
    // selected narrows the choices to the saved selection; upstream-only and
    // manual entries do not become selectable. A failed catalog request must
    // not hide the configured model either.
    expect(groups[1]?.models).toEqual(["b/selected"]);
    const titles = await catalogModelTitles(page);
    expect(titles).not.toContain("a/upstream-only");
    expect(titles).not.toContain("b/upstream-only");
    expect(titles).not.toContain("b/default");
    expect(titles).not.toContain("b/manual");
    expect(titles).not.toContain("c/default");
    expect(titles).not.toContain("a/empty");
    // Same model ID under source A is configured, but source B only discovers
    // it upstream; configuration must not leak across source cards.
    expect(groups[0]?.models).toContain("shared/model");
    expect(groups[1]?.models).not.toContain("shared/model");
    await expect
      .poll(async () =>
        (await page.getByRole("alert").first().innerText()).trim(),
      )
      .toContain("源 B");

    await pickModel(page, "源 B", "b/selected");
    await expect.poll(() => summaryTitle(page)).toContain("b/selected");
    await expect.poll(() => summaryTitle(page)).toContain("源 B");
    expect(await page.evaluate(() => window.__listModels.length)).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);

it("shows a historical pinned model as current but never offers it again", async () => {
  const { browser, page, pageErrors } = await openApp({
    isNew: false,
    settings: settings([
      source("a", "源 A", {
        model: "a/current",
        modelSelection: { mode: "all" },
      }),
    ]),
    catalogs: {
      a: [entry("a/current", 128000), entry("a/legacy", 256000)],
    },
    sessions: [sessionSummary("legacy-session", "a/legacy")],
    snapshots: {
      "legacy-session": sessionSnapshot("legacy-session", "a/legacy"),
    },
  });
  try {
    await page.evaluate(() => window.__selectSession("legacy-session"));
    await expect.poll(() => summaryTitle(page)).toContain("a/legacy");
    await expect
      .poll(async () =>
        (await page.locator(".composer-status").innerText()).trim(),
      )
      .toContain("当前模型 a/legacy 未在来源 源 A 的设置中启用");
    expect(await page.evaluate(() => window.__served["legacy-session"].model))
      .toBe("a/legacy");

    await openModelCatalog(page);
    const groups = await catalogGroups(page);
    expect(groups).toEqual([
      { label: "源 A", models: ["a/current"] },
    ]);
    expect(await catalogModelTitles(page)).not.toContain("a/legacy");

    await pickModel(page, "源 A", "a/current");
    await expect.poll(() => summaryTitle(page)).toContain("a/current");
    await expect.poll(() => page.locator(".composer-status").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);

it("saves added, protocol-overridden and removed models across a remount", async () => {
  const { browser, page, pageErrors } = await openApp({
    withSettings: true,
    settings: settings([
      source("a", "源 A", {
        model: "a/default",
        modelSelection: {
          mode: "selected",
          models: ["a/existing"],
          manual: [{ id: "a/existing", contextWindowTokens: null }],
          overrides: {
            "a/existing": { maxOutputTokens: 4096 },
            "a/other": { reasoningEffort: "high" },
          },
        },
      }),
    ]),
    catalogs: {
      a: [
        entry("a/default", 128000),
        entry("a/existing", 256000),
        entry("a/upstream", 64000),
      ],
    },
  });
  try {
    // The settings panel asks for the unfiltered upstream catalog while the
    // composer catalog stays filtered by the saved selection.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__access.some(
            (item) =>
              item.type === "catalog" &&
              item.sourceId === "a" &&
              item.includeUnselected === true,
          ),
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() =>
        window.__access.some(
          (item) =>
            item.type === "catalog" &&
            item.sourceId === "a" &&
            item.includeUnselected === undefined,
        ),
      ),
    ).toBe(true);
    await modelCard(page, "a/existing").waitFor();

    const existingProtocol = protocolSelect(page, "a/existing");
    await existingProtocol.waitFor();
    expect(
      await existingProtocol
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.getAttribute("value"))),
    ).toEqual(["", "chat-completions", "responses", "anthropic", "gemini"]);

    // A protocol override coexists with existing request fields and leaves the
    // source protocol plus every other model override untouched.
    await existingProtocol.selectOption("anthropic");
    const update1 = await saveSourceModels(page, "源 A");
    expect(sourceFields(update1)).toMatchObject({
      id: "a",
      apiMode: "chat-completions",
      modelSelection: {
        mode: "selected",
        models: ["a/existing"],
        manual: [{ id: "a/existing", contextWindowTokens: null }],
        overrides: {
          "a/existing": { maxOutputTokens: 4096, apiMode: "anthropic" },
          "a/other": { reasoningEffort: "high" },
        },
      },
    });

    // Upstream discovery remains the source of candidates for the settings
    // picker. Adding an upstream model is a draft until Save.
    await addConfiguredModel(page, "源 A", "a/upstream");
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).not.toContain("a/upstream");
    await closeModelPanel(page);
    expect(await page.evaluate(() => window.__updates.length)).toBe(1);

    // Discarding must not leave a phantom pin behind.
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    await expect
      .poll(() => modelCard(page, "a/upstream").count())
      .toBe(0);
    expect(
      await page.evaluate(
        () =>
          window.__wb.state.settings.providerSources[0].modelSelection.manual,
      ),
    ).toEqual([{ id: "a/existing", contextWindowTokens: null }]);
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).not.toContain("a/upstream");
    await closeModelPanel(page);

    // Adding a model with no parameters saves a minimal manual entry.
    await addConfiguredModel(page, "源 A", "a/upstream");
    await protocolSelect(page, "a/upstream").selectOption("responses");
    const update2 = await saveSourceModels(page, "源 A");
    const saved2 = sourceFields(update2);
    expect(saved2?.modelSelection.mode).toBe("selected");
    expect(saved2?.modelSelection.models).toEqual([
      "a/existing",
      "a/upstream",
    ]);
    expect(saved2?.modelSelection.manual).toEqual([
      { id: "a/existing", contextWindowTokens: null },
      { id: "a/upstream", contextWindowTokens: null },
    ]);
    expect(saved2?.modelSelection.overrides).toEqual({
      "a/existing": { maxOutputTokens: 4096, apiMode: "anthropic" },
      "a/other": { reasoningEffort: "high" },
      "a/upstream": { apiMode: "responses" },
    });
    expect(saved2?.apiMode).toBe("chat-completions");
    await expect
      .poll(() => modelCard(page, "a/upstream").count())
      .toBe(1);

    // The mounted composer follows the save without a reload.
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).toContain("a/upstream");
    await closeModelPanel(page);

    // A remount re-reads the saved settings, not component-local drafts.
    await remount(page);
    await modelCard(page, "a/existing").waitFor();
    await expect
      .poll(() => protocolSelect(page, "a/upstream").inputValue())
      .toBe("responses");
    await expect
      .poll(() => protocolSelect(page, "a/existing").inputValue())
      .toBe("anthropic");
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).toContain("a/upstream");
    await closeModelPanel(page);

    // Inheritance removes only apiMode; the minimal manual entry remains.
    await protocolSelect(page, "a/upstream").selectOption("");
    const update3 = await saveSourceModels(page, "源 A");
    const saved3 = sourceFields(update3);
    expect(saved3?.modelSelection.overrides?.["a/upstream"]).toBeUndefined();
    expect(saved3?.modelSelection.models).toEqual([
      "a/existing",
      "a/upstream",
    ]);
    expect(saved3?.modelSelection.manual).toEqual([
      { id: "a/existing", contextWindowTokens: null },
      { id: "a/upstream", contextWindowTokens: null },
    ]);
    expect(saved3?.modelSelection.overrides?.["a/existing"]).toEqual({
      maxOutputTokens: 4096,
      apiMode: "anthropic",
    });

    await remount(page);
    await modelCard(page, "a/upstream").waitFor();
    await expect
      .poll(() => protocolSelect(page, "a/upstream").inputValue())
      .toBe("");
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).toContain("a/upstream");
    await closeModelPanel(page);

    // Removal clears manual, selected models and a fresh override together.
    await protocolSelect(page, "a/upstream").selectOption("gemini");
    await page
      .getByRole("button", {
        name: "移除模型 a/upstream 配置卡片",
        exact: true,
      })
      .click();
    const update4 = await saveSourceModels(page, "源 A");
    const saved4 = sourceFields(update4);
    expect(saved4?.modelSelection.manual).toEqual([
      { id: "a/existing", contextWindowTokens: null },
    ]);
    expect(saved4?.modelSelection.models).toEqual(["a/existing"]);
    expect(saved4?.modelSelection.overrides).toEqual({
      "a/existing": { maxOutputTokens: 4096, apiMode: "anthropic" },
      "a/other": { reasoningEffort: "high" },
    });
    await expect
      .poll(() => modelCard(page, "a/upstream").count())
      .toBe(0);
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).not.toContain("a/upstream");
    await closeModelPanel(page);

    await remount(page);
    await modelCard(page, "a/existing").waitFor();
    await expect
      .poll(() => modelCard(page, "a/upstream").count())
      .toBe(0);
    await openModelCatalog(page);
    expect(await catalogModelTitles(page)).not.toContain("a/upstream");
    await closeModelPanel(page);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 45000);

it("edits a model protocol at a phone viewport without settings content overflow", async () => {
  const { browser, page, pageErrors } = await openApp(
    {
      withSettings: true,
      settings: settings([
        source("a", "源 A", {
          model: "a/default",
          modelSelection: {
            mode: "all",
            manual: [{ id: "a/mobile", contextWindowTokens: null }],
            overrides: { "a/mobile": { maxOutputTokens: 2048 } },
          },
        }),
      ]),
      catalogs: {
        a: [entry("a/default", 128000), entry("a/mobile", 256000)],
      },
    },
    { width: 390, height: 844 },
  );
  try {
    const select = protocolSelect(page, "a/mobile");
    await select.waitFor();
    await select.selectOption("gemini");
    const update = await saveSourceModels(page, "源 A");
    expect(sourceFields(update)?.modelSelection.overrides?.["a/mobile"]).toEqual(
      { maxOutputTokens: 2048, apiMode: "gemini" },
    );
    await expect.poll(() => select.inputValue()).toBe("gemini");
    const overflow = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>(".provider-sources");
      const rect = root?.getBoundingClientRect();
      const rightLimit = (rect?.right ?? 0) + 1;
      const culprits = root
        ? Array.from(root.querySelectorAll<HTMLElement>("*"))
            .map((element) => {
              const box = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                className:
                  typeof element.className === "string"
                    ? element.className
                    : "",
                width: box.width,
                right: box.right,
              };
            })
            .filter((item) => item.right > rightLimit)
            .sort((left, right) => right.right - left.right)
            .slice(0, 8)
        : [];
      return {
        innerWidth: window.innerWidth,
        providerWidth: rect?.width ?? 0,
        providerRight: rect?.right ?? 0,
        providerClientWidth: root?.clientWidth ?? 0,
        providerScrollWidth: root?.scrollWidth ?? 0,
        culprits,
      };
    });
    expect(overflow.providerRight).toBeLessThanOrEqual(overflow.innerWidth + 1);
    expect(overflow.providerScrollWidth).toBeLessThanOrEqual(
      overflow.providerClientWidth + 1,
    );
    expect(overflow.culprits).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
