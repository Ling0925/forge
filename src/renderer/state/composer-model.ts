import type { ModelCatalog, ModelCatalogEntry } from "../../shared/model-catalog";
import type { ConfigureInput, PublicProviderSource, PublicSettings } from "../../shared/schemas";

type ConfiguredModelSource = Pick<PublicProviderSource, "model" | "modelSelection">;

/** Discovery is metadata, not permission to offer an unconfigured model. */
export function configuredModelIds(source: ConfiguredModelSource): string[] {
  const selection = source.modelSelection;
  return [...new Set([
    source.model,
    ...(selection?.models ?? []),
    ...(selection?.manual ?? []).map((entry) => entry.id),
    ...Object.entries(selection?.overrides ?? {})
      .filter(([, override]) => Object.entries(override).some(([key, value]) =>
        key !== "provenance" && value != null && (!Array.isArray(value) || value.length > 0)))
      .map(([id]) => id),
  ].filter((id) => id.trim().length > 0))];
}

export function selectableModelIds(source: ConfiguredModelSource): string[] {
  const selection = source.modelSelection;
  if (selection?.mode === "none") return [];
  const configured = configuredModelIds(source);
  return selection?.mode === "selected"
    ? configured.filter((id) => selection.models?.includes(id))
    : configured;
}

/** The catalog is already merged by the host. Local settings also work before
 * it arrives (or for a selected custom ID hidden from discovery). Null inherits. */
export function composerModelMetadata(
  model: string,
  source: PublicProviderSource | undefined,
  catalog: ModelCatalog = [],
): ModelCatalogEntry | undefined {
  if (!model) return undefined;
  const actual = source?.modelAliases?.[model] ?? model;
  const selection = source?.modelSelection;
  const local = (id: string) => ({
    ...selection?.manual?.find((entry) => entry.id === id),
    ...selection?.overrides?.[id],
  });
  const candidates = [
    local(model), local(actual),
    catalog.find((entry) => entry.id === model),
    catalog.find((entry) => entry.id === actual),
  ];
  const contextWindowTokens = candidates.find((entry) => entry?.contextWindowTokens != null)?.contextWindowTokens ?? null;
  const maxOutputTokens = candidates.find((entry) => entry?.maxOutputTokens != null)?.maxOutputTokens;
  const reasoningEfforts = candidates.find((entry) => entry?.reasoningEfforts?.length)?.reasoningEfforts;
  return {
    id: model,
    contextWindowTokens,
    ...(maxOutputTokens == null ? {} : { maxOutputTokens }),
    ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
  };
}

/** Upstream/manual capability metadata is not a request override. Match the
 * host's selected model > wire alias > global request-effort precedence. */
export function composerReasoningEffort(
  model: string,
  source: PublicProviderSource | undefined,
  settings: Pick<PublicSettings, "reasoningEffort"> | null | undefined,
): NonNullable<PublicSettings["reasoningEffort"]> {
  const overrides = source?.modelSelection?.overrides;
  const actual = source?.modelAliases?.[model];
  return overrides?.[model]?.reasoningEffort
    ?? (actual ? overrides?.[actual]?.reasoningEffort : undefined)
    ?? settings?.reasoningEffort
    ?? "default";
}

export function composerEffortUpdate(
  model: string,
  source: PublicProviderSource | undefined,
  reasoningEffort: NonNullable<PublicSettings["reasoningEffort"]>,
): ConfigureInput {
  if (!source || !model) return { settings: { reasoningEffort } };
  // Never echo public credential/connection projections into a save. Omission
  // preserves their private fields on the host, with optimistic concurrency.
  const { hasApiKey: _key, credentials: _credentials, connection: _connection, revision, ...fields } = source;
  return {
    source: {
      type: "save",
      expectedRevision: revision,
      source: {
        ...fields,
        modelSelection: {
          ...source.modelSelection,
          mode: source.modelSelection?.mode ?? "all",
          overrides: {
            ...source.modelSelection?.overrides,
            [model]: { ...source.modelSelection?.overrides?.[model], reasoningEffort },
          },
        },
      },
    },
  };
}
