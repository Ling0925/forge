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
  Plugs,
  Check,
  Trash,
  ArrowClockwise,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { configureInputSchema } from "../../../shared/schemas";
import { modelCatalogCache, modelCatalogKey as catalogKey } from "../../state/model-catalog-cache";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import { Dialog } from "./Dialog";
import "./provider-sources.css";

type Draft = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiMode: "chat-completions" | "responses" | "anthropic";
  key: string;
  removeKey: boolean;
};

const protocols = [
  { value: "chat-completions", label: "OpenAI · Chat Completions" },
  { value: "responses", label: "OpenAI · Responses" },
  { value: "anthropic", label: "Anthropic · Messages" },
] as const;

const fresh = (): Draft => ({
  id: `source-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(36)).join("")}`,
  label: "",
  baseUrl: "",
  model: "",
  apiMode: "chat-completions",
  key: "",
  removeKey: false,
});

export function ProviderSources({
  onBusy,
  active = true,
}: { onBusy: (busy: boolean) => void; active?: boolean }) {
  const { state, updateSettings } = useWorkbench();
  const settings = state.settings;
  const sources = useMemo(
    () => settings?.providerSources ?? [],
    [settings?.providerSources],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalogs, setCatalogs] = useState<Record<string, readonly string[]>>(
    {},
  );
  const [catalogLoading, setCatalogLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [catalogErrors, setCatalogErrors] = useState<Record<string, string>>(
    {},
  );
  const [overviewSearch, setOverviewSearch] = useState("");
  const requestedCatalogs = useRef(new Set<string>());
  const pendingCatalogs = useRef(new Map<string, Promise<readonly string[]>>());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(50);
  const lock = useRef(false);
  const alive = useRef(true);
  const closeConfirmation = useRef<HTMLFieldSetElement>(null);
  const id = useId();
  const source = sources.find((item) => item.id === selected);
  const dirty = !baseline || JSON.stringify(draft) !== JSON.stringify(baseline);
  const hasEdits = baseline
    ? dirty
    : !!(
        draft.label ||
        draft.baseUrl ||
        draft.model ||
        draft.key ||
        draft.removeKey ||
        draft.apiMode !== "chat-completions"
      );
  const models =
    source && catalogKey(source) === catalogKey(draft)
      ? catalogs[catalogKey(source)]
      : undefined;
  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models?.filter((model) => model.toLowerCase().includes(query)) ?? [];
  }, [models, modelSearch]);

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
          }
        : fresh();
      setSelected(saved?.id ?? null);
      setDraft(next);
      setBaseline(saved ? next : null);
      setError("");
      setMessage("");
      setConfirmRemove(false);
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
    setDraft(fresh());
    setBaseline(null);
    setSelected(null);
  };

  const requestClose = () => {
    if (lock.current) return;
    if (hasEdits) setConfirmClose(true);
    else closeEditor();
  };

  useEffect(() => {
    if (confirmClose)
      closeConfirmation.current
        ?.querySelector<HTMLButtonElement>("[data-keep-editing]")
        ?.focus();
  }, [confirmClose]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
      const request = modelCatalogCache.load(
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
          if (alive.current)
            setCatalogErrors((old) => ({
              ...old,
              [key]:
                failure instanceof Error ? failure.message : "模型目录加载失败",
            }));
          throw failure;
        })
        .finally(() => {
          pendingCatalogs.current.delete(key);
          if (alive.current)
            setCatalogLoading((old) => ({ ...old, [key]: false }));
        });
      pendingCatalogs.current.set(key, request);
      return request;
    },
    [],
  );

  useEffect(() => {
    if (!active || !state.isSettingsOpen) return;
    for (const profile of sources) {
      if (!requestedCatalogs.current.has(catalogKey(profile))) {
        void loadCatalog(profile).catch(() => undefined);
      }
    }
  }, [active, state.isSettingsOpen, sources, loadCatalog]);

  const change = (patch: Partial<Draft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setError("");
    setMessage("");
    setConfirmRemove(false);
    setConfirmClose(false);
  };

  const operation = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : "操作失败，未自动重试。",
        );
    } finally {
      lock.current = false;
      onBusy(false);
      if (alive.current) {
        setBusy(false);
        setLoadingModels(false);
      }
    }
  };

  const persist = async () => {
    if (
      source?.hasApiKey &&
      draft.baseUrl !== source.baseUrl &&
      !draft.key &&
      !draft.removeKey
    )
      throw Error(
        "修改 API 地址时，请重新填写密钥或勾选清除旧密钥，避免把旧密钥发送到新来源。",
      );
    const { key, removeKey, ...profile } = draft;
    const input = configureInputSchema.parse({
      source: {
        type: "save",
        source: profile,
        ...(removeKey ? { apiKey: "" } : key ? { apiKey: key } : {}),
      },
    });
    if (!(await updateSettings(input)))
      throw Error("来源保存失败，输入已保留。请检查地址与配置后重试。");
    if (!alive.current) return;
    const saved = { ...draft, key: "", removeKey: false };
    setSelected(saved.id);
    setDraft(saved);
    setBaseline(saved);
    setEditorOpen(false);
    setMessage("来源已保存，可以从 /models 拉取模型。");
  };

  const fetchModels = () =>
    operation(async () => {
      if (!source || dirty) throw Error("请先保存此来源，再拉取模型。");
      setLoadingModels(true);
      const unique = await loadCatalog(source, true);
      if (!alive.current) return;
      setVisibleCount(50);
      setMessage(
        unique.length
          ? `已从此来源 /models 拉取 ${unique.length} 个模型。选择后请保存来源。`
          : "此来源返回空模型目录，可手动输入精确模型 ID。",
      );
    });

  const activate = () =>
    operation(async () => {
      if (dirty) throw Error("请先保存此来源，再设为当前来源。");
      if (!source?.model) throw Error("请先选择或输入默认模型并保存。");
      if (
        !(await updateSettings({ source: { type: "activate", id: source.id } }))
      )
        throw Error("切换来源失败，未自动重试。");
      if (alive.current)
        setMessage(
          "已切换当前来源。后续请求使用该来源，当前运行不会切换。已有会话请确认模型 ID 在此来源可用。",
        );
    });

  const remove = () =>
    operation(async () => {
      if (!source || settings?.activeSourceId === source.id) return;
      if (
        !(await updateSettings({ source: { type: "remove", id: source.id } }))
      )
        throw Error("删除来源失败。");
      if (!alive.current) return;
      selectSource(null);
      setEditorOpen(false);
      setMessage("来源已删除。其他来源不受影响。");
    });

  return (
    <section
      className="settings-section provider-sources"
      aria-label="模型来源管理"
    >
      <div className="provider-heading">
        <div>
          <h3>模型来源</h3>
          <p>管理服务地址与密钥，为每个来源设置默认模型。</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={16} />}
          disabled={!settings || busy || sources.length >= 20 || hasEdits}
          onClick={() => openEditor(null)}
        >
          添加来源
        </Button>
      </div>
      {sources.length > 0 ? (
        <div className="provider-source-list" aria-label="已保存的来源">
          <Input
            aria-label="搜索所有来源的模型"
            placeholder="搜索模型 ID 或来源名称"
            value={overviewSearch}
            onChange={(event) => setOverviewSearch(event.target.value)}
          />
          {sources.map((item) => {
            const key = catalogKey(item);
            const catalog = catalogs[key];
            const query = overviewSearch.trim().toLowerCase();
            const matchesSource = item.label.toLowerCase().includes(query);
            const displayed = (catalog ?? []).filter(
              (model) => matchesSource || model.toLowerCase().includes(query),
            );
            return (
              <section
                key={item.id}
                className="provider-overview"
                aria-label={`${item.label}的模型`}
              >
                <button
                  type="button"
                  className="provider-source-row"
                  aria-haspopup="dialog"
                  disabled={busy || hasEdits}
                  onClick={() => openEditor(item.id)}
                >
                  <Plugs size={20} aria-hidden="true" />
                  <span className="provider-source-info">
                    <span className="provider-source-title">
                      <strong>{item.label}</strong>
                      {settings?.activeSourceId === item.id && (
                        <span className="provider-current">
                          <Check size={12} />
                          当前
                        </span>
                      )}
                    </span>
                    <span className="provider-source-url">{item.baseUrl}</span>
                    <span className="provider-source-detail">
                      {
                        protocols.find(
                          (protocol) =>
                            protocol.value ===
                            (item.apiMode ?? "chat-completions"),
                        )?.label
                      }{" "}
                      · {item.model || "尚未设置默认模型"}
                    </span>
                  </span>
                  <span className="provider-source-selection">编辑</span>
                </button>
                <div className="provider-overview-toolbar">
                  <span>
                    {catalog === undefined
                      ? "模型目录"
                      : `${displayed.length} / ${catalog.length} 个模型`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowClockwise size={14} />}
                    aria-label={`刷新${item.label}的模型`}
                    loading={catalogLoading[key] ?? false}
                    onClick={() =>
                      void loadCatalog(item, true).catch(() => undefined)
                    }
                  >
                    刷新模型
                  </Button>
                </div>
                {catalogErrors[key] && (
                  <p className="provider-feedback provider-error">
                    {catalogErrors[key]}。可点击刷新重试。
                  </p>
                )}
                {catalog === undefined ? (
                  <p className="provider-hint">
                    {catalogLoading[key]
                      ? "正在加载模型…"
                      : "目录尚未加载，可刷新重试。"}
                  </p>
                ) : displayed.length ? (
                  <ul className="provider-overview-models">
                    {displayed.map((model) => (
                      <li key={model}>
                        <span>{model}</span>
                        {item.model === model && <small>默认</small>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="provider-hint">
                    {catalog.length
                      ? "没有匹配的模型。"
                      : "此来源返回空目录，可编辑来源手动填写模型 ID。"}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="provider-empty">添加第一个来源，连接你使用的模型服务。</p>
      )}

      {!editorOpen && message && (
        <output className="provider-feedback">{message}</output>
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
              每个来源独立保存地址、密钥和默认模型，不会自动切换当前来源。
            </p>
            <fieldset disabled={busy || !settings} className="provider-fields">
              <div className="provider-form-grid">
                <Field id={`${id}-label`} label="来源名称">
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
                  helper="填写 API 基础地址，不包含 /chat/completions 或 /messages。"
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
                    onChange={(event) =>
                      change({ baseUrl: event.target.value })
                    }
                  />
                </Field>
                <Field
                  className="provider-full-width"
                  id={`${id}-key`}
                  label="来源 API 密钥"
                  helper={
                    source?.hasApiKey
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
                    placeholder={
                      source?.hasApiKey
                        ? "已保存 · 输入以替换"
                        : "输入 API 密钥"
                    }
                    onChange={(event) => change({ key: event.target.value })}
                  />
                </Field>
              </div>
              {source?.hasApiKey && (
                <label className="provider-clear-key">
                  <input
                    type="checkbox"
                    checked={draft.removeKey}
                    onChange={(event) =>
                      change({ removeKey: event.target.checked, key: "" })
                    }
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
                    disabled={!selected || dirty || busy}
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
                  <div
                    className="provider-catalog"
                    aria-label="模型目录"
                    aria-busy={loadingModels}
                  >
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
                            {draft.model === model && (
                              <Check size={16} aria-label="已选" />
                            )}
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
                        显示更多（剩余 {filteredModels.length - visibleCount}{" "}
                        个）
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
            <div className="provider-actions">
              <Button
                variant="primary"
                disabled={busy || !settings || !hasEdits}
                onClick={() => void operation(persist)}
              >
                保存来源
              </Button>
              <Button variant="ghost" disabled={busy} onClick={requestClose}>
                关闭
              </Button>
              {hasEdits && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => selectSource(selected)}
                >
                  放弃此来源修改
                </Button>
              )}
              {source && (
                <Button
                  variant="secondary"
                  disabled={
                    busy ||
                    dirty ||
                    !source.model ||
                    settings?.activeSourceId === source.id
                  }
                  onClick={() => void activate()}
                >
                  设为当前来源
                </Button>
              )}
              {source && (
                <Button
                  className="provider-delete"
                  variant="ghost"
                  icon={<Trash size={15} />}
                  disabled={
                    busy || dirty || settings?.activeSourceId === source.id
                  }
                  onClick={() => setConfirmRemove(true)}
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
            {confirmRemove && source && (
              <div className="provider-remove-confirm">
                <p>删除“{source.label}”及其保存的密钥？此操作不可撤销。</p>
                <div className="provider-confirm-actions">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    确认删除来源
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmRemove(false)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
