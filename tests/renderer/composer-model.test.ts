import { expect, it } from "vitest";
import { composerEffortUpdate, composerModelMetadata, composerReasoningEffort } from "../../src/renderer/state/composer-model";
import { configureInputSchema, publicProviderSourceSchema } from "../../src/shared/schemas";

const source = publicProviderSourceSchema.parse({
  id: "a", label: "Source A", baseUrl: "https://a.test/v1", model: "alias", revision: 3, hasApiKey: true,
  modelAliases: { alias: "wire" },
  modelSelection: {
    mode: "selected", models: ["alias"],
    manual: [{ id: "wire", contextWindowTokens: 128000, reasoningEffort: "max" }],
    overrides: {
      wire: { reasoningEffort: "high", contextWindowTokens: 256000, maxOutputTokens: 8192, reasoningEfforts: ["low", "high"] },
      alias: { reasoningEffort: "default", maxOutputTokens: 16384 },
    },
  },
  credentials: [{ id: "default", label: "Key", type: "api-key", enabled: true, status: "ready" }],
});

it("uses exact source/model metadata before discovery arrives, including alias inheritance", () => {
  expect(composerModelMetadata("alias", source)).toEqual({
    id: "alias", contextWindowTokens: 256000, maxOutputTokens: 16384, reasoningEfforts: ["low", "high"],
  });
  expect(composerModelMetadata("alias", { ...source, modelSelection: undefined }, [
    { id: "alias", contextWindowTokens: null },
    { id: "wire", contextWindowTokens: 64000, reasoningEfforts: ["minimal", "high"] },
  ])).toEqual({ id: "alias", contextWindowTokens: 64000, reasoningEfforts: ["minimal", "high"] });
  expect(composerModelMetadata("wire-extra", source)?.contextWindowTokens).toBeNull();
  expect(composerModelMetadata("", source)).toBeUndefined();
});

it("inherits null limits and cleared overrides from the fresh catalog", () => {
  const inherited = { ...source, modelSelection: { mode: "all" as const, overrides: { wire: { contextWindowTokens: null, maxOutputTokens: null } } } };
  const catalog = [{ id: "wire", contextWindowTokens: 64000, maxOutputTokens: 4096 }];
  expect(composerModelMetadata("wire", inherited, catalog)).toEqual(catalog[0]);
  expect(composerModelMetadata("wire", { ...source, modelSelection: { mode: "all" } }, catalog)).toEqual(catalog[0]);
});

it("matches request effort precedence and never turns capability defaults into request overrides", () => {
  expect(composerReasoningEffort("alias", source, { reasoningEffort: "low" })).toBe("default");
  expect(composerReasoningEffort("wire", source, { reasoningEffort: "low" })).toBe("high");
  const inherited = { ...source, modelSelection: { ...source.modelSelection!, overrides: { wire: { reasoningEffort: "none" as const } } } };
  expect(composerReasoningEffort("alias", inherited, { reasoningEffort: "low" })).toBe("none");
  expect(composerReasoningEffort("wire", { ...source, modelSelection: { mode: "all", manual: source.modelSelection!.manual } }, { reasoningEffort: "low" })).toBe("low");
  expect(composerReasoningEffort("other", undefined, undefined)).toBe("default");
});

it("saves only the picked model's effort while preserving selection and other overrides", () => {
  const before = JSON.stringify(source);
  const input = configureInputSchema.parse(composerEffortUpdate("alias", source, "high"));
  expect(input.settings).toBeUndefined();
  expect(input.source).toMatchObject({
    type: "save", expectedRevision: 3,
    source: { id: "a", model: "alias", modelAliases: source.modelAliases, modelSelection: {
      ...source.modelSelection,
      overrides: { ...source.modelSelection!.overrides, alias: { reasoningEffort: "high", maxOutputTokens: 16384 } },
    } },
  });
  if (input.source?.type !== "save") throw new Error("Missing source save");
  expect(input.source.credentials).toBeUndefined();
  expect(input.source.connection).toBeUndefined();
  expect(input.source.apiKey).toBeUndefined();
  expect(input.source.source).not.toHaveProperty("hasApiKey");
  expect(input.source.source).not.toHaveProperty("revision");
  expect(JSON.stringify(source)).toBe(before);
  expect(composerEffortUpdate("model", undefined, "medium")).toEqual({ settings: { reasoningEffort: "medium" } });
});
