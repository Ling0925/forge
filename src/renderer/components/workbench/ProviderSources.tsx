import {
  ArrowClockwise,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PublicProviderPreset } from "../../../shared/model-access";
import type { ModelCatalog } from "../../../shared/model-catalog";
import {
  type PublicProviderSource,
  configureInputSchema,
} from "../../../shared/schemas";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import { Dialog } from "./Dialog";
import {
  type AccessDraft,
  type CatalogTestState,
  ConnectionEditor,
  CredentialsEditor,
  type EditableModelSelection,
  ImportPanel,
  ModelSelectionEditor,
  PresetPicker,
  RouteGroupsPanel,
  SourceCardModelPanel,
  accessDraft,
  aliasesObject,
  countModelOverrides,
  credentialRows,
  describedFailure,
  endpointProblem,
  freshAccessDraft,
  modelSelectionObject,
  presetEndpoints,
  protocolLabel,
  selectionDraft,
} from "./ModelAccessPanels";
import "./provider-sources.css";
import "./model-access.css";

const protocolOptions = [
  { value: "chat-completions", label: "Chat Completions" },
  { value: "responses", label: "Responses" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "gemini", label: "Gemini" },
] as const;

const freshSourceId = (sources: readonly PublicProviderSource[]) => {
  const taken = new Set(sources.map((item) => item.id));
  let candidate = "";
  do {
    candidate = `source-${Array.from(
      crypto.getRandomValues(new Uint32Array(2)),
      (value) => value.toString(36),
    ).join("")}`;
  } while (taken.has(candidate));
  return candidate;
};

const stableDraft = (draft: AccessDraft): string =>
  JSON.stringify({
    label: draft.label,
    baseUrl: draft.baseUrl,
    model: draft.model,
    apiMode: draft.apiMode,
    preset: draft.preset,
    region: draft.region,
    endpoints: draft.endpoints,
    modelSelection: {
      mode: draft.modelSelection.mode,
      models: draft.modelSelection.models,
      manual: draft.modelSelection.manual,
      overrides: draft.modelSelection.overrides,
    },
    aliases: draft.aliases.map((row) => [row.alias, row.model]),
    credentialRouting: draft.credentialRouting,
    sticky: draft.sticky,
    activeCredentialId: draft.activeCredentialId,
    credentials: draft.credentials.map((row) => ({
      id: row.id,
      label: row.label,
      enabled: row.enabled,
      type: row.type,
      protocol: row.protocol,
      hasKey: row.apiKey.length > 0,
      clearKey: row.clearKey,
    })),
    connection: {
      authEditing: draft.connection.authEditing,
      authType: draft.connection.authType,
      authHeader: draft.connection.authHeader,
      authPrefix: draft.connection.authPrefix,
      headersEditing: draft.connection.headersEditing,
      headersDirty: draft.connection.headersDirty,
      headers: draft.connection.headers.map((row) => [
        row.name,
        row.value,
        row.stored,
      ]),
      extraBodyEditing: draft.connection.extraBodyEditing,
      extraBodyText: draft.connection.extraBodyText,
      hasExtraBody: draft.connection.hasExtraBody,
      vertexEditing: draft.connection.vertexEditing,
      vertexText: draft.connection.vertexText,
      hasVertex: draft.connection.hasVertex,
      proxyEditing: draft.connection.proxyEditing,
      proxyUrl: draft.connection.proxyUrl,
    },
  });

const newDraft = (sources: readonly PublicProviderSource[]): AccessDraft =>
  freshAccessDraft(freshSourceId(sources));

type CatalogMeta = Readonly<{ stale: boolean; fetchedAt?: string }>;
type CatalogLoad = Readonly<{
  models: ModelCatalog;
  stale: boolean;
  fetchedAt?: string;
  error: string;
}>;

const refreshNotice = (loaded: CatalogLoad): string =>
  loaded.stale
    ? `刷新失败：${loaded.error || "目录未更新"}。保留 ${loaded.models.length} 个缓存模型。`
    : `目录已刷新：${loaded.models.length} 个模型。`;

function normalizedEndpoints(
  endpoints: AccessDraft["endpoints"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [protocol, value] of Object.entries(endpoints)) {
    if (value?.trim()) out[protocol] = value.trim();
  }
  return out;
}

function buildConnection(
  draft: AccessDraft,
): Record<string, unknown> | undefined {
  const connection: Record<string, unknown> = {};
  if (draft.connection.authEditing) {
    connection.auth = {
      type: draft.connection.authType,
      ...(draft.connection.authType === "header"
        ? { header: draft.connection.authHeader.trim() }
        : {}),
      ...(draft.connection.authPrefix
        ? { prefix: draft.connection.authPrefix }
        : {}),
    };
  }
  if (draft.connection.headersEditing && draft.connection.headersDirty) {
    const incomplete = draft.connection.headers.find(
      (row) => row.stored && row.name.trim() && !row.value,
    );
    if (incomplete)
      throw new Error("已保存的请求头值不会回显，请填写或删除对应请求头。");
    const headers: Record<string, string> = {};
    for (const row of draft.connection.headers) {
      const name = row.name.trim();
      if (name) headers[name] = row.value;
    }
    connection.headers = headers;
  }
  if (draft.connection.extraBodyEditing) {
    const text = draft.connection.extraBodyText.trim();
    // Blank leaves saved extra parameters untouched; `{}` clears them.
    if (text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("额外参数 JSON 格式错误。");
      }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error("额外参数必须是 JSON 对象。");
      connection.extraBody = parsed;
    }
  }
  if (draft.connection.vertexEditing) {
    const text = draft.connection.vertexText.trim();
    // Blank leaves the saved Vertex config untouched; an explicit null clears it.
    if (text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Vertex JSON 格式错误。");
      }
      if (
        parsed !== null &&
        (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
      )
        throw new Error("Vertex JSON 必须是对象或 null。");
      connection.vertex = parsed;
    }
  }
  if (draft.connection.proxyEditing)
    connection.proxyUrl = draft.connection.proxyUrl.trim();
  return Object.keys(connection).length ? connection : undefined;
}

export function ProviderSources({
  onBusy,
  active = true,
}: {
  readonly onBusy: (busy: boolean) => void;
  readonly active?: boolean;
}) {
  const { state, updateSettings, loadSettings } = useWorkbench();
  const settings = state.settings;
  const sources = useMemo<readonly PublicProviderSource[]>(
    () => settings?.providerSources ?? [],
    [settings?.providerSources],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<AccessDraft>(() => newDraft(sources));
  const [baseline, setBaseline] = useState<AccessDraft | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [presets, setPresets] = useState<readonly PublicProviderPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [catalogs, setCatalogs] = useState<
    Readonly<Record<string, ModelCatalog>>
  >({});
  const [catalogLoading, setCatalogLoading] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [catalogErrors, setCatalogErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [catalogMeta, setCatalogMeta] = useState<
    Readonly<Record<string, CatalogMeta | undefined>>
  >({});
  const [tests, setTests] = useState<
    Readonly<Record<string, CatalogTestState | undefined>>
  >({});
  const [confirmRemove, setConfirmRemove] = useState<Readonly<{
    sourceId: string;
    sessions: readonly string[];
  }> | null>(null);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [cardDrafts, setCardDrafts] = useState<
    Readonly<
      Record<
        string,
        {
          readonly model: string;
          readonly selection: EditableModelSelection;
        }
      >
    >
  >({});
  const requestedCatalogs = useRef(new Set<string>());
  const pendingCatalogs = useRef(new Map<string, Promise<CatalogLoad>>());
  const testRequests = useRef(
    new Map<string, { requestId: string; kind: "catalog" | "inference" }>(),
  );
  const lock = useRef(false);
  const alive = useRef(true);
  const closeConfirmation = useRef<HTMLFieldSetElement>(null);
  const id = useId();
  const effectiveTabId = useMemo(() => {
    if (activeTabId && sources.some((item) => item.id === activeTabId)) {
      return activeTabId;
    }
    if (
      settings?.activeSourceId &&
      sources.some((item) => item.id === settings.activeSourceId)
    ) {
      return settings.activeSourceId;
    }
    return sources[0]?.id ?? null;
  }, [activeTabId, sources, settings?.activeSourceId]);
  const source = sources.find((item) => item.id === selected);
  const dirty = baseline
    ? stableDraft(draft) !== stableDraft(baseline)
    : stableDraft(draft) !== stableDraft(freshAccessDraft(draft.id));
  const endpointError =
    draft.baseUrl === "" ? "" : endpointProblem(draft.baseUrl);
  const labelError =
    draft.label === ""
      ? ""
      : draft.label.trim() === ""
        ? "来源名称不能只有空白。"
        : "";
  const canSave =
    !busy &&
    !!settings &&
    dirty &&
    draft.label.trim() !== "" &&
    endpointProblem(draft.baseUrl) === "";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || !state.isSettingsOpen || presetsLoaded) return;
    setPresetsLoaded(true);
    if (!window.forge.modelAccess) return;
    void window.forge
      .modelAccess({ type: "presets" })
      .then((result) => {
        if (alive.current && result.type === "presets")
          setPresets(result.presets);
      })
      .catch(() => undefined);
  }, [active, state.isSettingsOpen, presetsLoaded]);

  const loadCatalog = useCallback(
    (sourceId: string, refresh = false): Promise<CatalogLoad> => {
      const pending = pendingCatalogs.current.get(sourceId);
      if (pending) return pending;
      requestedCatalogs.current.add(sourceId);
      setCatalogErrors((old) => ({ ...old, [sourceId]: "" }));
      setCatalogLoading((old) => ({ ...old, [sourceId]: true }));
      const request = (async (): Promise<CatalogLoad> => {
        if (window.forge.modelAccess) {
          const result = await window.forge.modelAccess({
            type: "catalog",
            sourceId,
            includeUnselected: true,
            ...(refresh ? { refresh: true } : {}),
          });
          if (result.type !== "catalog") throw new Error("目录响应类型错误。");
          // A stale result carries the last good catalog plus the refresh
          // failure; it must not be presented as a successful refresh.
          return {
            models: result.models,
            stale: result.stale === true,
            ...(result.fetchedAt ? { fetchedAt: result.fetchedAt } : {}),
            error: result.error ?? "",
          };
        }
        const models = await window.forge.listModels(sourceId, refresh);
        return {
          models: models.map((modelId) => ({
            id: modelId,
            contextWindowTokens: null,
          })),
          stale: false,
          error: "",
        };
      })()
        .then((loaded) => {
          if (alive.current) {
            setCatalogs((old) => ({ ...old, [sourceId]: loaded.models }));
            setCatalogErrors((old) => ({
              ...old,
              [sourceId]: loaded.error,
            }));
            setCatalogMeta((old) => ({
              ...old,
              [sourceId]: {
                stale: loaded.stale,
                ...(loaded.fetchedAt ? { fetchedAt: loaded.fetchedAt } : {}),
              },
            }));
          }
          return loaded;
        })
        .catch((failure: unknown) => {
          if (alive.current) {
            setCatalogErrors((old) => ({
              ...old,
              [sourceId]: describedFailure(failure),
            }));
            // Keep whatever was already listed; a failed refresh does not
            // invalidate the models the user could see before it.
            setCatalogMeta((old) => ({
              ...old,
              [sourceId]: { stale: true },
            }));
          }
          throw failure;
        })
        .finally(() => {
          requestedCatalogs.current.delete(sourceId);
          pendingCatalogs.current.delete(sourceId);
          if (alive.current)
            setCatalogLoading((old) => ({ ...old, [sourceId]: false }));
        });
      pendingCatalogs.current.set(sourceId, request);
      return request;
    },
    [],
  );

  useEffect(() => {
    if (!active || !state.isSettingsOpen) return;
    for (const item of sources) {
      if (
        catalogs[item.id] === undefined &&
        !requestedCatalogs.current.has(item.id) &&
        !pendingCatalogs.current.has(item.id)
      )
        void loadCatalog(item.id).catch(() => undefined);
    }
  }, [active, state.isSettingsOpen, sources, catalogs, loadCatalog]);

  const cancelTest = useCallback((sourceId: string) => {
    const activeTest = testRequests.current.get(sourceId);
    if (!activeTest) return;
    testRequests.current.delete(sourceId);
    setTests((old) => ({
      ...old,
      [sourceId]: {
        kind: activeTest.kind,
        status: "cancelled",
      },
    }));
    if (window.forge.modelAccess)
      void window.forge
        .modelAccess({ type: "cancel", requestId: activeTest.requestId })
        .catch(() => {});
  }, []);

  const cancelAllTests = useCallback(() => {
    for (const sourceId of [...testRequests.current.keys()])
      cancelTest(sourceId);
  }, [cancelTest]);

  useEffect(() => {
    return () => {
      for (const activeTest of testRequests.current.values()) {
        if (window.forge.modelAccess)
          void window.forge
            .modelAccess({ type: "cancel", requestId: activeTest.requestId })
            .catch(() => {});
      }
      testRequests.current.clear();
    };
  }, []);

  const runTest = async (sourceId: string, kind: "catalog" | "inference") => {
    if (testRequests.current.has(sourceId)) return;
    if (!window.forge.modelAccess) {
      setTests((old) => ({
        ...old,
        [sourceId]: {
          kind,
          status: "error",
          error: "当前宿主不支持模型测试。",
        },
      }));
      return;
    }
    const model = draft.model.trim() || source?.model || "";
    if (kind === "inference" && !model) {
      setTests((old) => ({
        ...old,
        [sourceId]: { kind, status: "error", error: "请选择模型。" },
      }));
      return;
    }
    const requestId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testRequests.current.set(sourceId, { requestId, kind });
    setTests((old) => ({ ...old, [sourceId]: { kind, status: "running" } }));
    try {
      const result = await window.forge.modelAccess({
        type: "test",
        sourceId,
        kind,
        requestId,
        ...(model ? { model } : {}),
        ...(draft.activeCredentialId
          ? { credentialId: draft.activeCredentialId }
          : {}),
      });
      if (result.type !== "test") throw new Error("测试响应类型错误。");
      if (!alive.current) return;
      // A canceled or superseded request must not overwrite its own status.
      if (testRequests.current.get(sourceId)?.requestId !== requestId) return;
      setTests((old) => ({
        ...old,
        [sourceId]: {
          kind,
          status: result.ok ? "ok" : "error",
          latencyMs: result.latencyMs,
          ...(result.model ? { model: result.model } : {}),
          ...(result.error ? { error: result.error } : {}),
        },
      }));
    } catch (testError) {
      if (
        alive.current &&
        testRequests.current.get(sourceId)?.requestId === requestId
      )
        setTests((old) => ({
          ...old,
          [sourceId]: {
            kind,
            status: "error",
            error: describedFailure(testError),
          },
        }));
    } finally {
      if (testRequests.current.get(sourceId)?.requestId === requestId)
        testRequests.current.delete(sourceId);
    }
  };

  useEffect(() => {
    if (state.isSettingsOpen || !editorOpen || lock.current) return;
    cancelAllTests();
    setEditorOpen(false);
    setConfirmClose(false);
    setConfirmRemove(null);
    setDraft(newDraft(sources));
    setBaseline(null);
    setSelected(null);
  }, [state.isSettingsOpen, editorOpen, sources, cancelAllTests]);

  useEffect(() => {
    if (confirmClose)
      closeConfirmation.current
        ?.querySelector<HTMLButtonElement>("[data-keep-editing]")
        ?.focus();
  }, [confirmClose]);

  const resetEditor = () => {
    cancelAllTests();
    setEditorOpen(false);
    setConfirmClose(false);
    setConfirmRemove(null);
    setDraft(newDraft(sources));
    setBaseline(null);
    setSelected(null);
  };

  const selectSource = useCallback(
    (sourceId: string | null) => {
      const saved = sources.find((item) => item.id === sourceId);
      setSelected(saved?.id ?? null);
      if (saved) {
        const base = accessDraft(saved);
        const pendingCard = cardDrafts[saved.id];
        setDraft(
          pendingCard
            ? {
                ...base,
                model: pendingCard.model,
                modelSelection: pendingCard.selection,
              }
            : base,
        );
        setBaseline(base);
      } else {
        setDraft(newDraft(sources));
        setBaseline(null);
      }
      setError("");
      setMessage("");
      setConfirmRemove(null);
      setConfirmClose(false);
    },
    [sources, cardDrafts],
  );

  const openEditor = (sourceId: string | null) => {
    selectSource(sourceId);
    setEditorOpen(true);
    const saved = sources.find((item) => item.id === sourceId);
    if (saved && catalogs[saved.id] === undefined && !catalogLoading[saved.id])
      void loadCatalog(saved.id).catch(() => undefined);
  };

  const requestClose = () => {
    if (lock.current) return;
    if (confirmRemove) {
      setConfirmRemove(null);
      return;
    }
    if (dirty) setConfirmClose(true);
    else resetEditor();
  };

  const change = (patch: Partial<AccessDraft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setError("");
    setMessage("");
    setConfirmClose(false);
    setConfirmRemove(null);
  };

  const changeBaseUrl = (value: string) => {
    setDraft((old) => {
      const endpoints = { ...old.endpoints };
      if (value.trim()) endpoints[old.apiMode] = value;
      else delete endpoints[old.apiMode];
      return { ...old, baseUrl: value, endpoints };
    });
    setError("");
    setMessage("");
  };

  const changeProtocol = (protocol: AccessDraft["apiMode"]) => {
    setDraft((old) => {
      const baseUrl = old.endpoints[protocol] ?? old.baseUrl;
      const endpoints = { ...old.endpoints };
      if (baseUrl.trim()) endpoints[protocol] = baseUrl;
      return { ...old, apiMode: protocol, baseUrl, endpoints };
    });
    setError("");
    setMessage("");
  };

  const selectPreset = (presetId: string) => {
    const chosen = presets.find((item) => item.id === presetId);
    if (!chosen) {
      change({ preset: "" });
      return;
    }
    const endpoints = presetEndpoints(chosen, "");
    const usable = protocolOptions.find((item) =>
      chosen.id === "google" ? item.value === "gemini" : endpoints[item.value],
    );
    change({
      preset: chosen.id,
      region: "",
      endpoints,
      label: draft.label.trim() ? draft.label : chosen.name,
      ...(usable
        ? { apiMode: usable.value, baseUrl: endpoints[usable.value] ?? "" }
        : chosen.id === "azure"
          ? { apiMode: "chat-completions", baseUrl: "" }
          : {}),
    });
  };

  const selectRegion = (regionId: string) => {
    const chosen = presets.find((item) => item.id === draft.preset);
    if (!chosen) return;
    const endpoints = presetEndpoints(chosen, regionId);
    const baseUrl = endpoints[draft.apiMode] ?? draft.baseUrl;
    change({ region: regionId, endpoints, baseUrl });
  };

  const operation = async (fn: () => Promise<string>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      const notice = await fn();
      if (alive.current && notice) setMessage(notice);
    } catch (failure) {
      if (alive.current) setError(describedFailure(failure));
    } finally {
      lock.current = false;
      onBusy(false);
      if (alive.current) setBusy(false);
    }
  };

  const adopt = (
    nextSettings: typeof settings | null | undefined,
    sourceId: string,
  ) => {
    const saved = nextSettings?.providerSources?.find(
      (item) => item.id === sourceId,
    );
    if (!saved) return;
    setSelected(saved.id);
    setActiveTabId(saved.id);
    setDraft(accessDraft(saved));
    setBaseline(accessDraft(saved));
  };

  const persist = () =>
    operation(async () => {
      if (!draft.credentials.length) throw new Error("至少需要一个凭据。");
      if (
        source?.hasApiKey &&
        draft.baseUrl.trim() !== source.baseUrl &&
        !draft.credentials.some(
          (credential) => credential.apiKey || credential.clearKey,
        )
      )
        throw new Error("修改 API 地址时，请填写密钥或勾选清除密钥。");
      const active = draft.credentials.find(
        (credential) => credential.id === draft.activeCredentialId,
      );
      const activeKey =
        active?.type === "api-key"
          ? active.clearKey
            ? ""
            : active.apiKey || undefined
          : undefined;
      const credentials = draft.credentials.map((credential) => ({
        id: credential.id,
        label: credential.label.trim() || "API 密钥",
        enabled: credential.enabled,
        type: credential.type,
        ...(credential.protocol ? { protocol: credential.protocol } : {}),
        ...(credential.type === "api-key"
          ? credential.clearKey
            ? { apiKey: "" }
            : credential.apiKey
              ? { apiKey: credential.apiKey }
              : {}
          : {}),
      }));
      const connection = buildConnection(draft);
      const parsed = configureInputSchema.safeParse({
        source: {
          type: "save",
          source: {
            id: draft.id,
            label: draft.label.trim(),
            baseUrl: draft.baseUrl.trim(),
            model: draft.model.trim(),
            apiMode: draft.apiMode,
            preset: draft.preset,
            endpoints: normalizedEndpoints(draft.endpoints),
            modelSelection: modelSelectionObject(draft.modelSelection),
            modelAliases: aliasesObject(draft.aliases),
            credentialRouting: draft.credentialRouting ?? "order",
            sticky: draft.sticky,
            ...(draft.activeCredentialId
              ? { activeCredentialId: draft.activeCredentialId }
              : {}),
          },
          credentials,
          ...(activeKey === undefined ? {} : { apiKey: activeKey }),
          ...(connection ? { connection } : {}),
          ...(draft.revision === undefined
            ? {}
            : { expectedRevision: draft.revision }),
        },
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map(
              (issue) => `${issue.path.slice(2).join(".")}：${issue.message}`,
            )
            .join("\n"),
        );
      const result = await updateSettings(parsed.data);
      if (!result.ok) throw new Error(result.error);
      if (!alive.current) return "";
      setCardDrafts((old) => {
        if (!old[draft.id]) return old;
        const next = { ...old };
        delete next[draft.id];
        return next;
      });
      adopt(result.settings, draft.id);
      setEditorOpen(false);
      void loadCatalog(draft.id, true).catch(() => undefined);
      return "来源已保存。";
    });

  const saveCardModelConfig = (item: PublicProviderSource) =>
    operation(async () => {
      const pending = cardDrafts[item.id];
      const nextModel = (pending?.model ?? item.model).trim();
      const nextSelection = pending?.selection ?? selectionDraft(item);
      const credentials = credentialRows(item).map((credential) => ({
        id: credential.id,
        label: credential.label.trim() || "API 密钥",
        enabled: credential.enabled,
        type: credential.type,
        ...(credential.protocol ? { protocol: credential.protocol } : {}),
      }));
      const parsed = configureInputSchema.safeParse({
        source: {
          type: "save",
          source: {
            id: item.id,
            label: item.label.trim(),
            baseUrl: item.baseUrl.trim(),
            model: nextModel,
            apiMode: item.apiMode ?? "chat-completions",
            preset: item.preset ?? "",
            endpoints: normalizedEndpoints(item.endpoints ?? {}),
            modelSelection: modelSelectionObject(nextSelection),
            modelAliases: item.modelAliases ?? {},
            credentialRouting: item.credentialRouting ?? "order",
            sticky: item.sticky === true,
            ...(item.activeCredentialId
              ? { activeCredentialId: item.activeCredentialId }
              : {}),
          },
          credentials,
          ...(item.revision === undefined
            ? {}
            : { expectedRevision: item.revision }),
        },
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues
            .map(
              (issue) => `${issue.path.slice(2).join(".")}：${issue.message}`,
            )
            .join("\n"),
        );
      const result = await updateSettings(parsed.data);
      if (!result.ok) throw new Error(result.error);
      if (!alive.current) return "";
      setCardDrafts((old) => {
        const next = { ...old };
        delete next[item.id];
        return next;
      });
      if (selected === item.id) {
        adopt(result.settings, item.id);
      }
      void loadCatalog(item.id, true).catch(() => undefined);
      return "模型参数已保存。";
    });

  const remove = (sourceId: string, forgottenSessionIds?: readonly string[]) =>
    operation(async () => {
      const result = await updateSettings({
        source: {
          type: "remove",
          id: sourceId,
          ...(forgottenSessionIds ? { forgottenSessionIds } : {}),
        },
      });
      if (!result.ok) {
        const pinned = state.sessions
          .filter((item) => item.providerSourceId === sourceId)
          .map((item) => item.id);
        if (!forgottenSessionIds && pinned.length > 0)
          setConfirmRemove({ sourceId, sessions: pinned });
        throw new Error(result.error);
      }
      if (!alive.current) return "";
      selectSource(null);
      setEditorOpen(false);
      return "来源已删除。";
    });

  const reloadAfterLogin = async () => {
    const next = await loadSettings();
    const saved = next?.providerSources?.find((item) => item.id === draft.id);
    if (!saved) return;
    const unchanged = baseline
      ? stableDraft(draft) === stableDraft(baseline)
      : false;
    if (unchanged) {
      const rebuilt = accessDraft(saved);
      setDraft(rebuilt);
      setBaseline(rebuilt);
    } else {
      setDraft((old) => ({
        ...old,
        credentials: credentialRows(saved),
        activeCredentialId: saved.activeCredentialId ?? old.activeCredentialId,
        revision: saved.revision,
      }));
      setBaseline((old) =>
        old
          ? {
              ...old,
              credentials: credentialRows(saved),
              activeCredentialId:
                saved.activeCredentialId ?? old.activeCredentialId,
              revision: saved.revision,
            }
          : old,
      );
    }
    setMessage("登录完成。");
    void loadCatalog(saved.id, true).catch(() => undefined);
  };

  const removeTarget = confirmRemove
    ? sources.find((item) => item.id === confirmRemove.sourceId)
    : undefined;

  return (
    <section
      className="settings-section provider-sources"
      aria-label="模型来源管理"
    >
      <div className="provider-heading">
        <h3>模型来源</h3>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={16} />}
          disabled={!settings || busy || sources.length >= 20}
          onClick={() => openEditor(null)}
        >
          添加来源
        </Button>
      </div>

      {sources.length > 0 ? (
        <div className="provider-sources-tabbed">
          <div
            className="provider-source-tabs"
            role="tablist"
            aria-label="模型来源切换"
          >
            {sources.map((item, index) => {
              const isTabActive = item.id === effectiveTabId;
              const isDefault = settings?.activeSourceId === item.id;
              const savedSelection = selectionDraft(item);
              const effectiveSelection =
                cardDrafts[item.id]?.selection ?? savedSelection;
              const overrideCount = countModelOverrides(
                effectiveSelection.overrides,
              );
              const hasUnsaved = cardDrafts[item.id] !== undefined;
              return (
                <button
                  key={item.id}
                  id={`${id}-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={isTabActive}
                  aria-controls={`${id}-panel-${item.id}`}
                  tabIndex={isTabActive ? 0 : -1}
                  className={`provider-source-tab${isTabActive ? " is-active" : ""}${isDefault ? " is-current" : ""}`}
                  onClick={() => setActiveTabId(item.id)}
                  onKeyDown={(event) => {
                    if (sources.length <= 1) return;
                    let nextIndex = -1;
                    if (event.key === "ArrowRight") {
                      nextIndex = (index + 1) % sources.length;
                    } else if (event.key === "ArrowLeft") {
                      nextIndex = (index - 1 + sources.length) % sources.length;
                    } else if (event.key === "Home") {
                      nextIndex = 0;
                    } else if (event.key === "End") {
                      nextIndex = sources.length - 1;
                    }
                    if (nextIndex >= 0) {
                      event.preventDefault();
                      const target = sources[nextIndex];
                      if (target) {
                        setActiveTabId(target.id);
                        document
                          .getElementById(`${id}-tab-${target.id}`)
                          ?.focus();
                      }
                    }
                  }}
                >
                  <span
                    className={`provider-source-tab-dot${isDefault ? " is-current" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="provider-source-tab-label">
                    {item.label}
                  </span>
                  {isDefault && (
                    <span className="provider-source-tab-badge is-default">
                      默认
                    </span>
                  )}
                  {overrideCount > 0 && (
                    <span
                      className="provider-source-tab-badge is-custom"
                      title={`已定制 ${overrideCount} 个模型`}
                    >
                      {overrideCount}
                    </span>
                  )}
                  {hasUnsaved && (
                    <span
                      className="provider-source-tab-unsaved"
                      title="有未保存的模型配置"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <ul className="provider-source-list" aria-label="已保存的来源">
            {sources.map((item) => {
              const isTabActive = item.id === effectiveTabId;
              const isDefault = settings?.activeSourceId === item.id;
              const loading = catalogLoading[item.id] ?? false;
              const catalog = catalogs[item.id];
              const meta = catalogMeta[item.id];
              const savedSelection = selectionDraft(item);
              const cardDraft = cardDrafts[item.id];
              const effectiveModel = cardDraft?.model ?? item.model;
              const effectiveSelection = cardDraft?.selection ?? savedSelection;
              const overrideCount = countModelOverrides(
                effectiveSelection.overrides,
              );
              const cardDirty =
                cardDraft !== undefined &&
                JSON.stringify({
                  model: cardDraft.model.trim(),
                  selection: modelSelectionObject(cardDraft.selection),
                }) !==
                  JSON.stringify({
                    model: item.model.trim(),
                    selection: modelSelectionObject(savedSelection),
                  });

              return (
                <li
                  key={item.id}
                  id={`${id}-panel-${item.id}`}
                  hidden={!isTabActive}
                  className={`provider-source-card${isDefault ? " is-current" : ""}${isTabActive ? " is-active-tab" : ""}`}
                >
                  <div className="provider-source-summary-bar">
                    <div className="provider-source-summary-info">
                      <div className="provider-source-head">
                        <span className="provider-source-title">
                          <strong>{item.label}</strong>
                          {isDefault && (
                            <span className="provider-current">默认</span>
                          )}
                          <span className="provider-tag">
                            {item.credentials?.length ?? 1} 凭据
                          </span>
                          <span className="provider-tag is-muted">
                            {item.hasApiKey ? "已保存密钥" : "无密钥"}
                          </span>
                          {overrideCount > 0 && (
                            <span className="provider-tag is-customized">
                              已定制 {overrideCount} 个模型
                            </span>
                          )}
                          {meta?.stale && catalog && catalog.length > 0 && (
                            <span className="provider-tag is-stale">
                              已过期
                            </span>
                          )}
                        </span>
                        <span className="provider-source-protocol">
                          {protocolLabel(item.apiMode)}
                        </span>
                      </div>
                      <div className="provider-source-meta-line">
                        <span className="provider-source-url">
                          {item.baseUrl}
                        </span>
                        <span className="model-access-separator">·</span>
                        <span className="provider-source-detail">
                          默认模型 <code>{effectiveModel || "未选择"}</code>
                          <span className="model-access-separator">·</span>
                          {effectiveSelection.mode === "all"
                            ? "全部模型"
                            : effectiveSelection.mode === "none"
                              ? "不提供模型"
                              : `${effectiveSelection.models.length} 个模型`}
                          {catalogLoading[item.id] && (
                            <span className="model-access-separator">
                              · 加载中
                            </span>
                          )}
                          {catalog && (
                            <span className="model-access-separator">
                              · 目录 {catalog.length}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="provider-source-actions">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<PencilSimple size={14} />}
                        aria-label={`编辑${item.label}`}
                        disabled={busy}
                        onClick={() => openEditor(item.id)}
                      >
                        编辑来源
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<ArrowClockwise size={14} />}
                        aria-label={`刷新${item.label}的模型`}
                        loading={loading || catalogLoading[item.id] === true}
                        disabled={busy}
                        onClick={() =>
                          void operation(async () => {
                            const loaded = await loadCatalog(item.id, true);
                            return refreshNotice(loaded);
                          })
                        }
                      >
                        刷新目录
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="provider-delete"
                        icon={<Trash size={14} />}
                        disabled={busy}
                        onClick={() =>
                          setConfirmRemove({ sourceId: item.id, sessions: [] })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </div>

                  {catalogErrors[item.id] && (
                    <p
                      className="provider-feedback provider-error"
                      role="alert"
                    >
                      {catalogErrors[item.id]}
                    </p>
                  )}

                  <SourceCardModelPanel
                    sourceLabel={item.label}
                    catalog={catalog ?? []}
                    loading={loading}
                    error={catalogErrors[item.id]}
                    model={effectiveModel}
                    selection={effectiveSelection}
                    dirty={cardDirty}
                    saving={busy}
                    disabled={busy}
                    onModel={(nextModel) => {
                      setCardDrafts((old) => ({
                        ...old,
                        [item.id]: {
                          model: nextModel,
                          selection: effectiveSelection,
                        },
                      }));
                      if (selected === item.id) {
                        change({ model: nextModel });
                      }
                    }}
                    onSelection={(nextSelection) => {
                      setCardDrafts((old) => ({
                        ...old,
                        [item.id]: {
                          model: effectiveModel,
                          selection: nextSelection,
                        },
                      }));
                      if (selected === item.id) {
                        change({ modelSelection: nextSelection });
                      }
                    }}
                    onResetDraft={() => {
                      setCardDrafts((old) => {
                        const next = { ...old };
                        delete next[item.id];
                        return next;
                      });
                      if (selected === item.id) {
                        change({
                          model: item.model,
                          modelSelection: savedSelection,
                        });
                      }
                    }}
                    onSave={() => void saveCardModelConfig(item)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="provider-empty">无来源。</p>
      )}

      {!editorOpen && message && (
        <output className="provider-feedback">{message}</output>
      )}
      {!editorOpen && error && (
        <p className="provider-feedback provider-error" role="alert">
          {error}
        </p>
      )}

      {removeTarget && !editorOpen && (
        <fieldset className="provider-remove-confirm" aria-label="确认删除来源">
          <p>
            删除“{removeTarget.label}”？
            {confirmRemove && confirmRemove.sessions.length > 0 && (
              <>
                {` ${confirmRemove.sessions.length} 个会话仍绑定此来源：`}
                {confirmRemove.sessions.slice(0, 5).join("、")}
                {confirmRemove.sessions.length > 5 ? " 等" : ""}。
              </>
            )}
          </p>
          <div className="provider-confirm-actions">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void remove(
                  removeTarget.id,
                  confirmRemove && confirmRemove.sessions.length > 0
                    ? confirmRemove.sessions
                    : undefined,
                )
              }
            >
              确认删除来源
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmRemove(null)}
            >
              取消
            </Button>
          </div>
        </fieldset>
      )}

      <ImportPanel
        onApplied={async (ids) => {
          const next = await loadSettings();
          for (const imported of ids)
            if (next?.providerSources?.some((item) => item.id === imported))
              void loadCatalog(imported).catch(() => undefined);
          setMessage(`已导入 ${ids.length} 个来源。`);
        }}
      />

      <RouteGroupsPanel catalogs={catalogs} />

      {editorOpen && (
        <Dialog
          title={source ? `编辑来源 · ${source.label}` : "添加来源"}
          onClose={requestClose}
          dismissible={!busy}
          initialFocus="input"
        >
          <div className="provider-editor modal-content">
            <fieldset disabled={busy || !settings} className="provider-fields">
              <PresetPicker
                presets={presets}
                preset={draft.preset}
                region={draft.region}
                onPreset={selectPreset}
                onRegion={selectRegion}
              />
              <div className="provider-form-grid">
                <Field
                  id={`${id}-label`}
                  label="来源名称"
                  error={labelError || undefined}
                >
                  <Input
                    id={`${id}-label`}
                    value={draft.label}
                    placeholder="来源名称"
                    onChange={(event) => change({ label: event.target.value })}
                  />
                </Field>
                <Field id={`${id}-protocol`} label="协议">
                  <Select
                    id={`${id}-protocol`}
                    value={draft.apiMode}
                    options={protocolOptions}
                    onChange={(event) =>
                      changeProtocol(
                        event.target.value as AccessDraft["apiMode"],
                      )
                    }
                  />
                </Field>
                <Field
                  className="provider-full-width"
                  id={`${id}-url`}
                  label="API 地址"
                  error={endpointError || undefined}
                >
                  <Input
                    id={`${id}-url`}
                    value={draft.baseUrl}
                    placeholder="https://api.example.com/v1"
                    spellCheck={false}
                    onChange={(event) => changeBaseUrl(event.target.value)}
                  />
                </Field>
              </div>

              <ModelSelectionEditor
                catalog={catalogs[draft.id] ?? []}
                loading={catalogLoading[draft.id] ?? false}
                error={catalogErrors[draft.id] ?? ""}
                stale={Boolean(
                  catalogMeta[draft.id]?.stale &&
                    (catalogs[draft.id]?.length ?? 0) > 0,
                )}
                fetchedAt={catalogMeta[draft.id]?.fetchedAt}
                model={draft.model}
                selection={draft.modelSelection}
                aliases={draft.aliases}
                disabled={busy || !source || dirty}
                test={tests[draft.id]}
                onModel={(model) => change({ model })}
                onSelection={(selection) =>
                  change({ modelSelection: selection })
                }
                onAliases={(aliases) => change({ aliases })}
                onRefresh={() => {
                  if (!source) return;
                  void operation(async () => {
                    const loaded = await loadCatalog(source.id, true);
                    return refreshNotice(loaded);
                  });
                }}
                onTest={(kind) => void runTest(draft.id, kind)}
                onCancelTest={() => cancelTest(draft.id)}
              />

              <section className="model-access-section" aria-label="凭据路由">
                <div className="model-access-heading">
                  <h4>凭据路由</h4>
                </div>
                <div className="model-access-form-grid">
                  <Field id={`${id}-credential-routing`} label="策略">
                    <Select
                      id={`${id}-credential-routing`}
                      value={draft.credentialRouting ?? "order"}
                      options={[
                        { value: "order", label: "顺序" },
                        { value: "rotate", label: "轮换" },
                        { value: "usage", label: "用量" },
                        { value: "smart", label: "智能" },
                        { value: "pace", label: "节流" },
                      ]}
                      onChange={(event) =>
                        change({
                          credentialRouting: event.target
                            .value as AccessDraft["credentialRouting"],
                        })
                      }
                    />
                  </Field>
                  <label className="model-access-check">
                    <input
                      type="checkbox"
                      checked={draft.sticky}
                      onChange={(event) =>
                        change({ sticky: event.target.checked })
                      }
                    />
                    黏性
                  </label>
                </div>
              </section>

              <CredentialsEditor
                sourceId={draft.id}
                sourceReady={Boolean(source)}
                credentials={draft.credentials}
                activeCredentialId={draft.activeCredentialId}
                disabled={busy}
                onCredentials={(credentials) => change({ credentials })}
                onActive={(activeCredentialId) =>
                  change({ activeCredentialId })
                }
                onCompleted={reloadAfterLogin}
              />

              <ConnectionEditor
                connection={draft.connection}
                disabled={busy}
                onChange={(connection) => change({ connection })}
              />
            </fieldset>

            {error && (
              <p className="provider-feedback provider-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <output className="provider-feedback">{message}</output>
            )}
            {confirmClose && (
              <fieldset
                ref={closeConfirmation}
                className="provider-remove-confirm"
                disabled={busy}
                aria-label="放弃未保存修改"
              >
                <p>放弃未保存的修改？</p>
                <div className="provider-confirm-actions">
                  <Button variant="danger" onClick={resetEditor}>
                    放弃修改并关闭
                  </Button>
                  <Button
                    data-keep-editing
                    variant="secondary"
                    onClick={() => setConfirmClose(false)}
                  >
                    继续编辑
                  </Button>
                </div>
              </fieldset>
            )}
            {confirmRemove && (
              <fieldset
                className="provider-remove-confirm"
                aria-label="确认删除来源"
              >
                <p>
                  删除“{removeTarget?.label ?? confirmRemove.sourceId}”？
                  {confirmRemove.sessions.length > 0 && (
                    <>
                      {` ${confirmRemove.sessions.length} 个会话仍绑定此来源：`}
                      {confirmRemove.sessions.slice(0, 5).join("、")}
                      {confirmRemove.sessions.length > 5 ? " 等" : ""}。
                    </>
                  )}
                </p>
                <div className="provider-confirm-actions">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void remove(
                        confirmRemove.sourceId,
                        confirmRemove.sessions.length > 0
                          ? confirmRemove.sessions
                          : undefined,
                      )
                    }
                  >
                    确认删除来源
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmRemove(null)}
                  >
                    取消
                  </Button>
                </div>
              </fieldset>
            )}
            <div className="provider-actions">
              <Button
                variant="primary"
                disabled={!canSave}
                onClick={() => void persist()}
              >
                保存来源
              </Button>
              <Button variant="ghost" disabled={busy} onClick={requestClose}>
                关闭
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => selectSource(selected)}
                >
                  放弃修改
                </Button>
              )}
              {source && (
                <Button
                  className="provider-delete"
                  variant="ghost"
                  icon={<Trash size={15} />}
                  disabled={busy || dirty}
                  onClick={() =>
                    setConfirmRemove({ sourceId: source.id, sessions: [] })
                  }
                >
                  删除来源
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
