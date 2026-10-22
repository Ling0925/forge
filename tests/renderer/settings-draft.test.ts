import { expect, it } from "vitest";
import { defaultPublicSettings as base } from "../../src/shared/schemas";
import { buildSettingsUpdate, createSettingsDraft } from "../../src/renderer/state/settings-draft";
it("sends only edited fields and allows appearance before provider setup", () => {
  const draft = createSettingsDraft(base);
  expect(buildSettingsUpdate(draft, base, "", false)).toEqual({});
  draft.theme = "dark";
  expect(buildSettingsUpdate(draft, base, "", false)).toEqual({ settings: { theme: "dark" } });
});
it("never carries provider endpoint fields: those belong to a source", () => {
  const draft = createSettingsDraft(base) as unknown as Record<string, unknown>;
  expect(draft).not.toHaveProperty("baseUrl");
  expect(draft).not.toHaveProperty("model");
  expect(draft).not.toHaveProperty("apiMode");
  const update = buildSettingsUpdate({ ...createSettingsDraft(base), theme: "light" }, base, "", false);
  expect(update.settings).toEqual({ theme: "light" });
  expect(update).not.toHaveProperty("apiKey");
});
it("preserves keys by default and clears only on explicit intent", () => {
  const draft = createSettingsDraft(base);
  expect(buildSettingsUpdate(draft, base, "", false).apiKey).toBeUndefined();
  expect(buildSettingsUpdate(draft, base, "", true)).toEqual({ apiKey: "" });
  expect(buildSettingsUpdate(draft, base, "fixture-key", false)).toEqual({ apiKey: "fixture-key" });
  expect(() => buildSettingsUpdate(draft, base, "fixture-key", true)).toThrow("不能同时");
});
it("supports optional token caps, exact model windows and clearing rows", () => {
  const original = { ...base, contextBudgetTokens: 32000, modelContextWindows: { fixture: 100000 } };
  const draft = createSettingsDraft(original);
  draft.contextBudgetTokens = "";
  draft.modelContextWindows = [];
  expect(buildSettingsUpdate(draft, original, "", false)).toEqual({ settings: { contextBudgetTokens: null, modelContextWindows: {} } });
  draft.modelContextWindows = [{ model: "alias", tokens: "" }];
  expect(buildSettingsUpdate(draft, original, "", false).settings?.modelContextWindows).toEqual({ alias: null });
  draft.modelContextWindows.push({ model: "alias", tokens: "1000" });
  expect(() => buildSettingsUpdate(draft, original, "", false)).toThrow("重复");
});
it("keeps legacy tool-call budgets out of the form while request timeouts stay editable", () => {
  const legacy = { ...base, maxToolCalls: 250, maxRootToolCalls: 900, rootTimeoutMs: 600000 };
  const form = createSettingsDraft(legacy) as unknown as Record<string, unknown>;
  expect(form).not.toHaveProperty("maxToolCalls");
  expect(form).not.toHaveProperty("maxRootToolCalls");
  expect(form).not.toHaveProperty("rootTimeoutMs");
  expect(buildSettingsUpdate({ ...createSettingsDraft(legacy), requestTimeoutMs: "30000" }, legacy, "", false)).toEqual({
    settings: { requestTimeoutMs: 30000 },
  });
});
it("validates numeric blanks, origin boundaries and LSP arguments", () => {
  let draft = createSettingsDraft(base);
  draft.requestTimeoutMs = "";
  expect(() => buildSettingsUpdate(draft, base, "", false)).toThrow("整数");
  draft = createSettingsDraft(base);
  draft.browserAllowedOrigins = "https://example.test/path";
  expect(() => buildSettingsUpdate(draft, base, "", false)).toThrow("browserAllowedOrigins");
  draft.browserAllowedOrigins = " http://localhost:3000\n";
  draft.lspServers = [{ id: "ts", command: "typescript-language-server", args: '["--stdio"]', extensions: ".ts, .tsx" }];
  const update = buildSettingsUpdate(draft, base, "", false);
  expect(update.settings?.browserAllowedOrigins).toEqual(["http://localhost:3000"]);
  expect(update.settings?.lspServers?.[0]?.args).toEqual(["--stdio"]);
  draft.lspServers[0]!.args = "--stdio";
  expect(() => buildSettingsUpdate(draft, base, "", false)).toThrow("JSON");
});
