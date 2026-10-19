import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Plus,
  Check,
  Trash,
  ArrowClockwise,
  MagnifyingGlass,
  PencilSimple,
  Plugs,
} from "@phosphor-icons/react";
import { configureInputSchema } from "../../../shared/schemas";
import type { PublicProviderSource } from "../../../shared/schemas";
import { modelCatalogCache, modelCatalogKey as catalogKey } from "../../state/model-catalog-cache";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import { Dialog } from "./Dialog";
import "./provider-sources.css";

type ApiMode = "chat-completions" | "responses" | "anthropic";

type Draft = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiMode: ApiMode;
  key: string;
  removeKey: boolean;
  revision: number | undefined;
};

/** Values the editor opened with; any difference means unsaved edits exist. */
type Baseline = Readonly<{
  label: string;
  baseUrl: string;
  model: string;
  apiMode: ApiMode;
}>;

const protocols = [
  { value: "chat-completions", label: "OpenAI · Chat Completions" },
  { value: "responses", label: "OpenAI · Responses" },
  { value: "anthropic", label: "Anthropic · Messages" },
] as const;

/**
 * Endpoint mistakes are the most common failure here, so validate the exact
 * shape the store enforces before the save button can be pressed.
 */
function endpointProblem(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "请填写 API 基础地址。";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "API 地址必须是完整的 http(s) URL。";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "API 地址只支持 http 或 https。";
  if (url.username || url.password) return "API 地址不能包含用户名或密码。";
  if (url.search || url.hash) return "API 地址不能包含查询参数或锚点。";
  return "";
}

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，未自动重试。";
}

function freshDraft(sources: readonly PublicProviderSource[]): Draft {
  const taken = new Set(sources.map((item) => item.id));
  let candidate = "";
  do {
    candidate = `source-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join("")}`;
  } while (taken.has(candidate));
  return {
    id: candidate,
    label: "",
    baseUrl: "",
    model: "",
    apiMode: "chat-completions",
    key: "",
    removeKey: false,
    revision: undefined,
  };
}

export function ProviderSources({
  onBusy,
  active = true,
}: {
  onBusy: (busy: boolean) => void;
  active?: boolean;
}) {
  const { state, updateSettings } = useWorkbench();
  const settings = state.settings;
  const sources = useMemo<readonly PublicProviderSource[]>(
    () => settings?.providerSources ?? [],
    [settings?.providerSources],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => freshDraft(sources));
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalogs, setCatalogs] = useState<Record<string, readonly string[]>>({});
  const [catalogLoading, setCatalogLoading] = useState<Record<string, boolean>>({});
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<
    Readonly<{ sourceId: string; sessions: readonly string[] }> | null
  >(null);
  const [modelSearch, setModelSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const requestedCatalogs = useRef(new Set<string>());
  const pendingCatalogs = useRef(new Map<string, Promise<readonly string[]>>());
  const lock = useRef(false);
  const alive = useRef(true);
  const closeConfirmation = useRef<HTMLFieldSetElement>(null);
  const id = useId();
  const source = sources.find((item) => item.id === selected);

  const dirty = baseline
    ? draft.label !== baseline.label ||
      draft.baseUrl !== baseline.baseUrl ||
      draft.model !== baseline.model ||
      draft.apiMode !== baseline.apiMode ||
      draft.key !== "" ||
      draft.removeKey
    : draft.label !== "" ||
      draft.baseUrl !== "" ||
      draft.model !== "" ||
      draft.key !== "" ||
      draft.removeKey ||
      draft.apiMode !== "chat-completions";

  const endpointError = draft.baseUrl === "" ? "" : endpointProblem(draft.baseUrl);
  const labelError = draft.label === "" ? "" : draft.label.trim() === "" ? "来源名称不能只有空白。" : "";
  const canSave = !busy && !!settings && dirty && draft.label.trim() !== "" && endpointProblem(draft.baseUrl) === "";

  const models =
    source && catalogKey(source) === catalogKey(draft) ? catalogs[catalogKey(source)] : undefined;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models?.filter((model) => model.toLowerCase().includes(query)) ?? [];
  }, [models, modelSearch]);

  const loadCatalog = useCallback(
    (profile: Parameters<typeof catalogKey>[0], refresh = false) => {
      const key = catalogKey(profile);
      const pending = pendingCatalogs.current.get(key);
      if (pending) return pending;
      requestedCatalogs.current.add(key);
      const cached = modelCatalogCache.read(key);
      if (cached) setCatalogs((old) => ({ ...old, [key]: cached }));
      setCatalogErrors((old) => ({ ...old, [key]: "" }));
      if (cached && !refresh) return Promise.resolve(cached);
      setCatalogLoading((old) => ({ ...old, [key]: true }));
      const request = modelCatalogCache
        .load(
          key,
          async () => [...new Set(await window.forge.listModels(profile.id))],
          refresh,
        )
        .then((result) => {
          const unique = [...new Set(result)];
          if (alive.current) setCatalogs((old) => ({ ...old, [key]: unique }));
          return unique;
        })
        .catch((failure: unknown) => {
          // A failed refresh must not leave the previous catalog looking valid.
          if (alive.current) {
            setCatalogErrors((old) => ({ ...old, [key]: describeFailure(failure) }));
            setCatalogs((old) => ({ ...old, [key]: [] }));
          }
          throw failure;
        })
        .finally(() => {
          requestedCatalogs.current.delete(key);
          pendingCatalogs.current.delete(key);
          if (alive.current) setCatalogLoading((old) => ({ ...old, [key]: false }));
        });
      pendingCatalogs.current.set(key, request);
      return request;
    },
    [],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || !state.isSettingsOpen) return;
    // Drop catalogs for sources that no longer exist (renamed endpoints, deletes)
    // so a stale list can never be shown as this source's models.
    modelCatalogCache.retain(sources.map((source) => catalogKey(source)));
    for (const profile of sources) {
      if (catalogs[catalogKey(profile)] === undefined && !requestedCatalogs.current.has(catalogKey(profile)))
        void loadCatalog(profile).catch(() => undefined);
    }
  }, [active, state.isSettingsOpen, sources, catalogs, loadCatalog]);

  // The dialog is portaled to <body>, so switching settings sections can no
  // longer hide it. Only closing the settings page itself dismisses it.
  useEffect(() => {
    if (state.isSettingsOpen || !editorOpen || lock.current) return;
    setEditorOpen(false);
    setConfirmClose(false);
    setConfirmRemove(null);
    setDraft(freshDraft(sources));
    setBaseline(null);
    setSelected(null);
  }, [state.isSettingsOpen, editorOpen, sources]);

  const selectSource = useCallback(
    (sourceId: string | null) => {
      const saved = sources.find((item) => item.id === sourceId);
      const next: Draft = saved
        ? {
            id: saved.id,
            label: saved.label,
            baseUrl: saved.baseUrl,
            model: saved.model,
            apiMode: saved.apiMode ?? "chat-completions",
            key: "",
            removeKey: false,
            revision: saved.revision,
          }
        : freshDraft(sources);
      setSelected(saved?.id ?? null);
      setDraft(next);
      setBaseline(
        saved
          ? {
              label: saved.label,
              baseUrl: saved.baseUrl,
              model: saved.model,
              apiMode: saved.apiMode ?? "chat-completions",
            }
          : null,
      );
      setError("");
      setMessage("");
      setConfirmRemove(null);
      setConfirmClose(false);
      setModelSearch("");
      setVisibleCount(50);
    },
    [sources],
  );

  const openEditor = (sourceId: string | null) => {
    selectSource(sourceId);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (lock.current) return;
    setEditorOpen(false);
    setConfirmClose(false);
    setConfirmRemove(null);
    setDraft(freshDraft(sources));
    setBaseline(null);
    setSelected(null);
  };

  const requestClose = () => {
    if (lock.current) return;
    // A pending delete confirmation is dismissed first; closing the editor is a
    // separate, explicit step so Escape never silently deletes or discards.
    if (confirmRemove) {
      setConfirmRemove(null);
      return;
    }
    if (dirty) setConfirmClose(true);
    else closeEditor();
  };

  useEffect(() => {
    if (confirmClose)
      closeConfirmation.current
        ?.querySelector<HTMLButtonElement>("[data-keep-editing]")
        ?.focus();
  }, [confirmClose]);

  const change = (patch: Partial<Draft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setError("");
    setMessage("");
    setConfirmRemove(null);
    setConfirmClose(false);
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
      if (alive.current) setError(describeFailure(failure));
    } finally {
      lock.current = false;
      onBusy(false);
      if (alive.current) {
        setBusy(false);
        setLoadingModels(false);
      }
    }
  };

  /** Rebuild the editor from the authoritative settings the store returned. */
  const adopt = (next: readonly PublicProviderSource[] | undefined, sourceId: string) => {
    const saved = next?.find((item) => item.id === sourceId);
    if (!saved) return;
    setSelected(saved.id);
    setDraft({
      id: saved.id,
      label: saved.label,
      baseUrl: saved.baseUrl,
      model: saved.model,
      apiMode: saved.apiMode ?? "chat-completions",
      key: "",
      removeKey: false,
      revision: saved.revision,
    });
    setBaseline({
      label: saved.label,
      baseUrl: saved.baseUrl,
      model: saved.model,
      apiMode: saved.apiMode ?? "chat-completions",
    });
  };

  const persist = () =>
    operation(async () => {
      if (source?.hasApiKey && draft.baseUrl !== source.baseUrl && !draft.key && !draft.removeKey)
        throw Error("修改 API 地址时，请重新填写密钥或勾选清除旧密钥，避免把旧密钥发送到新来源。");
      const { key, removeKey, revision, ...profile } = draft;
      const parsed = configureInputSchema.safeParse({
        source: {
          type: "save",
          source: { ...profile, label: profile.label.trim() },
          ...(removeKey ? { apiKey: "" } : key ? { apiKey: key } : {}),
          ...(revision === undefined ? {} : { expectedRevision: revision }),
        },
      });
      if (!parsed.success)
        throw Error(
          parsed.error.issues
            .map((issue) => `${issue.path.slice(2).join(".")}：${issue.message}`)
            .join("\n"),
        );
      const wasActive = settings?.activeSourceId;
      const result = await updateSettings(parsed.data);
      if (!result.ok) throw Error(result.error);
      if (!alive.current) return "";
      adopt(result.settings.providerSources, draft.id);
      setEditorOpen(false);
      return wasActive === undefined
        ? "来源已保存，并自动设为当前来源。可以从 /models 拉取模型。"
        : "来源已保存，可以从 /models 拉取模型。";
    });

  const fetchModels = () =>
    operation(async () => {
      if (!source) throw Error("请先选择一个已保存的来源。");
      if (
        source.model !== draft.model ||
        source.baseUrl !== draft.baseUrl ||
        (source.apiMode ?? "chat-completions") !== draft.apiMode
      )
        throw Error("请先保存此来源，再拉取模型。");
      setLoadingModels(true);
      const unique = await loadCatalog(source, true);
      if (!alive.current) return "";
      setVisibleCount(50);
      return unique.length
        ? `已从此来源 /models 拉取 ${unique.length} 个模型。选择后请保存来源。`
        : "此来源返回空模型目录，可手动输入精确模型 ID。";
    });

  const activate = (sourceId: string) =>
    operation(async () => {
      const candidate = sources.find((item) => item.id === sourceId);
      if (!candidate) throw Error("来源不存在，可能已在别处删除。");
      if (candidate.model === "") throw Error("请先选择或输入默认模型并保存。");
      const result = await updateSettings({ source: { type: "activate", id: sourceId } });
      if (!result.ok) throw Error(result.error);
      return "已切换当前来源。后续请求使用该来源，当前运行不会切换。已有会话使用各自绑定的来源。";
    });

  /** Sessions known to the workbench that still pin this source. */
  const pinnedSessions = (sourceId: string) =>
    state.sessions.filter((item) => item.providerSourceId === sourceId).map((item) => item.id);

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
        // The store refuses while any session is pinned; resolve the affected
        // sessions locally so the next attempt can carry an explicit ack.
        const pinned = pinnedSessions(sourceId);
        if (!forgottenSessionIds && pinned.length > 0)
          setConfirmRemove({ sourceId, sessions: pinned });
        throw Error(result.error);
      }
      if (!alive.current) return "";
      selectSource(null);
      setEditorOpen(false);
      return "来源已删除。其他来源不受影响。";
    });

  const requestRemove = (sourceId: string) => setConfirmRemove({ sourceId, sessions: [] });
  const editingNew = editorOpen && !source;
  const removeTarget = confirmRemove
    ? sources.find((item) => item.id === confirmRemove.sourceId)
    : undefined;

  return (
    <section className="settings-section provider-sources" aria-label="模型来源管理">
      <div className="provider-heading">
        <div>
          <h3>模型来源</h3>
          <p>管理服务地址与密钥，为每个来源设置默认模型。</p>
        </div>
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
        <ul className="provider-source-list" aria-label="已保存的来源">
          {sources.map((item) => {
            const current = settings?.activeSourceId === item.id;
            const key = catalogKey(item);
            const loading = catalogLoading[key] ?? false;
            return (
              <li key={item.id} className={`provider-source-card${current ? " is-current" : ""}`}>
                <div className="provider-source-head">
                  <span className="provider-source-title">
                    <strong>{item.label}</strong>
                    {current && <span className="provider-current">当前</span>}
                    <span className={`provider-tag${item.hasApiKey ? "" : " is-muted"}`}>
                      {item.hasApiKey ? "已保存密钥" : "无密钥"}
                    </span>
                  </span>
                  <span className="provider-source-protocol">
                    {protocols.find((entry) => entry.value === (item.apiMode ?? "chat-completions"))?.label}
                  </span>
                </div>
                <p className="provider-source-url">{item.baseUrl}</p>
                <p className="provider-source-detail">
                  默认模型：<code>{item.model || "尚未选择"}</code>
                </p>
                {catalogErrors[key] && (
                  <p className="provider-feedback provider-error">目录加载失败：{catalogErrors[key]}</p>
                )}
                <div className="provider-source-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<PencilSimple size={14} />}
                    aria-label={`编辑${item.label}`}
                    disabled={busy}
                    onClick={() => openEditor(item.id)}
                  >
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowClockwise size={14} />}
                    aria-label={`刷新${item.label}的模型`}
                    loading={loading}
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => {
                        const unique = await loadCatalog(item, true);
                        return unique.length
                          ? `已从 ${item.label} 拉取 ${unique.length} 个模型。`
                          : `${item.label} 返回空模型目录。`;
                      })
                    }
                  >
                    刷新模型
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || current || item.model === ""}
                    onClick={() => void activate(item.id)}
                  >
                    设为当前
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="provider-delete"
                    icon={<Trash size={14} />}
                    disabled={busy || current}
                    onClick={() => requestRemove(item.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="provider-empty">添加第一个来源，连接你使用的模型服务。</p>
      )}

      {!editorOpen && message && <output className="provider-feedback">{message}</output>}

      {removeTarget && !editorOpen && (
        <fieldset className="provider-remove-confirm" aria-label="确认删除来源">
          <p>
            删除“{removeTarget.label}”及其保存的密钥？此操作不可撤销。
            {confirmRemove && confirmRemove.sessions.length > 0 && (
              <>
                {" "}
                {confirmRemove.sessions.length} 个会话仍绑定此来源：
                {confirmRemove.sessions.slice(0, 5).join("、")}
                {confirmRemove.sessions.length > 5 ? " 等" : ""}。
              </>
            )}
          </p>
          <p className="provider-hint">
            {confirmRemove && confirmRemove.sessions.length > 0
              ? "删除后这些会话无法继续运行，需要重新选择来源。"
              : "来源被会话引用时，删除前会先确认受影响的会话。"}
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
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(null)}>
              取消
            </Button>
          </div>
        </fieldset>
      )}

      {editorOpen && (
        <Dialog
          title={source ? `编辑来源 · ${source.label}` : "添加来源"}
          onClose={requestClose}
          dismissible={!busy}
          initialFocus="input"
        >
          <div className="provider-editor modal-content">
            <p className="provider-hint">
              每个来源独立保存地址、密钥和默认模型。保存后可在工作台选择来源与模型。
            </p>
            <fieldset disabled={busy || !settings} className="provider-fields">
              <div className="provider-form-grid">
                <Field id={`${id}-label`} label="来源名称" error={labelError || undefined}>
                  <Input
                    id={`${id}-label`}
                    value={draft.label}
                    placeholder="例如：我的 OpenAI"
                    onChange={(event) => change({ label: event.target.value })}
                  />
                </Field>
                <Field id={`${id}-protocol`} label="协议">
                  <Select
                    id={`${id}-protocol`}
                    value={draft.apiMode}
                    options={protocols}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (
                        value === "chat-completions" ||
                        value === "responses" ||
                        value === "anthropic"
                      )
                        change({ apiMode: value });
                    }}
                  />
                </Field>
                <Field
                  className="provider-full-width"
                  id={`${id}-url`}
                  label="API 地址"
                  error={endpointError || undefined}
                  helper={
                    draft.apiMode === "anthropic"
                      ? "填写 API 基础地址，例如 https://api.anthropic.com；不要包含 /messages。"
                      : "填写 API 基础地址，例如 https://api.openai.com/v1；不要包含 /chat/completions。"
                  }
                >
                  <Input
                    id={`${id}-url`}
                    aria-describedby={`${id}-url-helper`}
                    value={draft.baseUrl}
                    placeholder={
                      draft.apiMode === "anthropic"
                        ? "https://api.anthropic.com"
                        : "https://api.openai.com/v1"
                    }
                    spellCheck={false}
                    onChange={(event) => change({ baseUrl: event.target.value })}
                  />
                </Field>
                <Field
                  className="provider-full-width"
                  id={`${id}-key`}
                  label="来源 API 密钥"
                  helper={
                    draft.removeKey
                      ? "保存后将清除已保存的密钥。"
                      : source?.hasApiKey
                        ? "已保存密钥，留空则继续使用。"
                        : "密钥仅用于此来源；无需认证的服务可留空。"
                  }
                >
                  <Input
                    id={`${id}-key`}
                    aria-describedby={`${id}-key-helper`}
                    type="password"
                    autoComplete="new-password"
                    value={draft.key}
                    disabled={draft.removeKey}
                    placeholder={source?.hasApiKey ? "已保存 · 输入以替换" : "输入 API 密钥"}
                    onChange={(event) => change({ key: event.target.value })}
                  />
                </Field>
              </div>
              {source?.hasApiKey && (
                <label className="provider-clear-key">
                  <input
                    type="checkbox"
                    checked={draft.removeKey}
                    onChange={(event) => change({ removeKey: event.target.checked })}
                  />
                  清除已保存的密钥
                </label>
              )}

              <div className="provider-model-section">
                <div className="provider-heading">
                  <div>
                    <h4>默认模型</h4>
                    <p>输入精确 ID，或从此来源的目录中选择。</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ArrowClockwise size={15} />}
                    loading={loadingModels}
                    disabled={!source || dirty || busy}
                    onClick={() => void fetchModels()}
                  >
                    从 /models 拉取
                  </Button>
                </div>
                <Field id={`${id}-model`} label="默认模型 ID">
                  <Input
                    id={`${id}-model`}
                    className="provider-model-input"
                    value={draft.model}
                    spellCheck={false}
                    placeholder="例如：gpt-4.1 或服务提供的模型 ID"
                    onChange={(event) => change({ model: event.target.value })}
                  />
                </Field>
                {models !== undefined ? (
                  <div className="provider-catalog" aria-label="模型目录" aria-busy={loadingModels}>
                    <div className="provider-catalog-toolbar">
                      <div className="provider-model-search">
                        <MagnifyingGlass size={16} aria-hidden="true" />
                        <Input
                          aria-label="搜索模型"
                          value={modelSearch}
                          placeholder="搜索模型 ID"
                          onChange={(event) => {
                            setModelSearch(event.target.value);
                            setVisibleCount(50);
                          }}
                        />
                      </div>
                      <span>
                        {filteredModels.length} / {models.length}
                      </span>
                    </div>
                    {filteredModels.length > 0 ? (
                      <div className="provider-model-list">
                        {filteredModels.slice(0, visibleCount).map((model) => (
                          <button
                            type="button"
                            key={model}
                            className="model-catalog-option"
                            aria-pressed={draft.model === model}
                            onClick={() => change({ model })}
                          >
                            <span>{model}</span>
                            {draft.model === model && <Check size={16} aria-label="已选" />}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="provider-empty">
                        {models.length
                          ? "没有匹配的模型，试试其他关键词。"
                          : "目录为空，可手动填写模型 ID。"}
                      </p>
                    )}
                    {filteredModels.length > visibleCount && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setVisibleCount((count) => count + 50)}
                      >
                        显示更多（剩余 {filteredModels.length - visibleCount} 个）
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="provider-hint">
                    {dirty
                      ? "保存来源后即可拉取模型目录。"
                      : "尚未加载目录。不支持 /models 的服务可直接填写模型 ID。"}
                  </p>
                )}
              </div>
            </fieldset>

            {error && (
              <p className="provider-feedback provider-error" role="alert">
                {error}
              </p>
            )}
            {message && <output className="provider-feedback">{message}</output>}
            {confirmClose && (
              <fieldset
                ref={closeConfirmation}
                className="provider-remove-confirm"
                disabled={busy}
                aria-label="放弃未保存修改"
              >
                <p>此来源有未保存的修改，确定放弃并关闭？</p>
                <div className="provider-confirm-actions">
                  <Button variant="danger" onClick={closeEditor}>
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
              <fieldset className="provider-remove-confirm" aria-label="确认删除来源">
                <p>
                  删除“{removeTarget?.label ?? confirmRemove.sourceId}”及其保存的密钥？此操作不可撤销。
                  {confirmRemove.sessions.length > 0 && (
                    <>
                      {" "}
                      {confirmRemove.sessions.length} 个会话仍绑定此来源：
                      {confirmRemove.sessions.slice(0, 5).join("、")}
                      {confirmRemove.sessions.length > 5 ? " 等" : ""}。删除后这些会话无法继续运行。
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
                        confirmRemove.sessions.length > 0 ? confirmRemove.sessions : undefined,
                      )
                    }
                  >
                    确认删除来源
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(null)}>
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
                title={!dirty ? "没有需要保存的修改。" : labelError || endpointError || undefined}
              >
                保存来源
              </Button>
              <Button variant="ghost" disabled={busy} onClick={requestClose}>
                关闭
              </Button>
              {dirty && (
                <Button variant="ghost" disabled={busy} onClick={() => selectSource(selected)}>
                  放弃此来源修改
                </Button>
              )}
              {source && (
                <Button
                  variant="secondary"
                  disabled={
                    busy || dirty || !source.model || settings?.activeSourceId === source.id
                  }
                  onClick={() => void activate(source.id)}
                >
                  设为当前来源
                </Button>
              )}
              {source && (
                <Button
                  className="provider-delete"
                  variant="ghost"
                  icon={<Trash size={15} />}
                  disabled={busy || dirty || settings?.activeSourceId === source.id}
                  onClick={() => requestRemove(source.id)}
                >
                  删除来源
                </Button>
              )}
            </div>
            {source && settings?.activeSourceId === source.id && (
              <p className="provider-hint">
                当前来源用于后续请求。切换到其他来源后，才能删除此来源。
              </p>
            )}
            {editingNew && (
              <p className="provider-hint">
                <Plugs size={14} aria-hidden="true" /> 保存后可在工作台选择该来源及其模型。
              </p>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
