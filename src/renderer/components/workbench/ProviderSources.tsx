import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Plus,
  Plugs,
  Check,
  Trash,
  ArrowClockwise,
  CaretDown,
  CaretUp,
  Cpu,
  Brain,
  CurrencyDollar,
  MagnifyingGlass,
  SlidersHorizontal,
  PencilSimple,
} from "@phosphor-icons/react";
import { configureInputSchema, type ConfigureInput } from "../../../shared/schemas";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import "./provider-sources.css";

type Draft = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiMode: "chat-completions" | "responses";
  key: string;
  removeKey: boolean;
};

const fresh = (): Draft => ({
  id: `source-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`,
  label: "",
  baseUrl: "",
  model: "",
  apiMode: "chat-completions",
  key: "",
  removeKey: false,
});

export function getModelSpecs(
  model: string,
  baseUrl = "",
  modelContextWindows: Readonly<Record<string, number | null>> = {}
) {
  const m = model.toLowerCase();
  const url = baseUrl.toLowerCase();
  const isLocal =
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("0.0.0.0") ||
    url.includes(":11434") ||
    url.includes(":1234") ||
    url.includes(":8080");

  let context = "128K tokens";
  if (modelContextWindows[model]) {
    const tokens = modelContextWindows[model]!;
    context =
      tokens >= 1000000
        ? `${(tokens / 1000000).toFixed(1)}M tokens`
        : `${Math.round(tokens / 1000)}K tokens`;
  } else if (
    m.includes("gpt-4.1") ||
    m.includes("gemini-1.5-flash") ||
    m.includes("gemini-2.0-flash")
  ) {
    context = "1M tokens";
  } else if (m.includes("gemini-1.5-pro") || m.includes("gemini-2.0-pro")) {
    context = "2M tokens";
  } else if (
    m.includes("o3") ||
    m.includes("o4") ||
    m.includes("claude-3") ||
    m.includes("sonnet") ||
    m.includes("opus")
  ) {
    context = "200K tokens";
  } else if (m.includes("gpt-4o") || m.includes("gpt-4-turbo")) {
    context = "128K tokens";
  } else if (m.includes("deepseek")) {
    context = "64K tokens";
  } else if (m.includes("flash") || m.includes("mini") || m.includes("nano")) {
    context = "128K tokens";
  } else {
    context = "300K tokens (估算)";
  }

  let reasoning = "模型默认";
  if (
    m.includes("reasoner") ||
    m.includes("r1") ||
    m.includes("o1") ||
    m.includes("o3") ||
    m.includes("o4")
  ) {
    reasoning = "支持深度思考";
  } else if (
    m.includes("flash") ||
    m.includes("mini") ||
    m.includes("nano") ||
    m.includes("haiku")
  ) {
    reasoning = "轻量极速";
  } else if (m.includes("sonnet") || m.includes("gpt-4") || m.includes("pro")) {
    reasoning = "标准通用";
  } else if (isLocal) {
    reasoning = "本地推理";
  }

  let pricing = "按端点标准计费";
  if (isLocal) {
    pricing = "免费 (本地计算)";
  } else if (m.includes("gpt-4o-mini")) {
    pricing = "$0.15 / $0.60 / M";
  } else if (m.includes("gpt-4o")) {
    pricing = "$2.50 / $10.00 / M";
  } else if (m.includes("o1-mini") || m.includes("o3-mini") || m.includes("o4-mini")) {
    pricing = "$1.10 / $4.40 / M";
  } else if (m.includes("o1")) {
    pricing = "$15.00 / $60.00 / M";
  } else if (m.includes("deepseek-reasoner") || m.includes("r1")) {
    pricing = "¥4.00 / ¥16.00 / M";
  } else if (m.includes("deepseek")) {
    pricing = "¥1.00 / ¥2.00 / M";
  } else if (m.includes("claude-3-5-sonnet") || m.includes("sonnet")) {
    pricing = "$3.00 / $15.00 / M";
  } else if (m.includes("claude-3-5-haiku") || m.includes("haiku")) {
    pricing = "$0.80 / $4.00 / M";
  } else if (m.includes("claude-3-opus") || m.includes("opus")) {
    pricing = "$15.00 / $75.00 / M";
  } else if (m.includes("gemini")) {
    pricing = "$1.25 / $5.00 / M";
  }

  return { context, reasoning, pricing };
}

export function ProviderSources({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { state, updateSettings } = useWorkbench();
  const settings = state.settings;
  const sources = settings?.providerSources ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [models, setModels] = useState<readonly string[] | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [sourceModelsCache, setSourceModelsCache] = useState<Record<string, readonly string[]>>({});
  const [modelSearch, setModelSearch] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);

  const source = sources.find((item) => item.id === selected);
  const dirty = !baseline || JSON.stringify(draft) !== JSON.stringify(baseline);
  const hasEdits = baseline
    ? dirty
    : !!(draft.label || draft.baseUrl || draft.model || draft.key || draft.removeKey);

  const selectSource = (id: string | null) => {
    const saved = sources.find((item) => item.id === id);
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
    setModels(saved && sourceModelsCache[saved.id] ? sourceModelsCache[saved.id] : null);
    setError("");
    setMessage("");
    setConfirmRemove(false);
    setModelSearch("");
    if (saved) {
      setExpandedSources((old) => ({ ...old, [saved.id]: true }));
    }
  };

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !settings) return;
    initialized.current = true;
    const initialId = settings.activeSourceId ?? sources[0]?.id ?? null;
    selectSource(initialId);
    if (initialId) {
      setExpandedSources({ [initialId]: true });
    }
  }, [settings]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const change = (patch: Partial<Draft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setError("");
    setMessage("");
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
        setError(failure instanceof Error ? failure.message : "操作失败，未自动重试。");
    } finally {
      lock.current = false;
      onBusy(false);
      if (alive.current) setBusy(false);
    }
  };

  const persist = async () => {
    if (source?.hasApiKey && draft.baseUrl !== source.baseUrl && !draft.key && !draft.removeKey)
      throw Error(
        "修改 API 地址时，请重新填写密钥或勾选清除旧密钥，避免把旧密钥发送到新来源。"
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
    setMessage("来源已保存，可以从 /models 拉取模型。");
  };

  const fetchModelsForId = async (id: string) => {
    const result = await window.forge.listModels(id);
    if (alive.current) {
      setSourceModelsCache((old) => ({ ...old, [id]: result }));
      if (selected === id) {
        setModels(result);
      }
      setExpandedSources((old) => ({ ...old, [id]: true }));
      setMessage(
        result.length
          ? `已从此来源 /models 拉取 ${result.length} 个模型。选择后请保存来源。`
          : "此来源返回空模型目录。可检查服务配置，或手动输入精确模型 ID。"
      );
    }
    return result;
  };

  const fetchModels = () =>
    operation(async () => {
      if (!selected || dirty)
        throw Error("请先保存此来源，再拉取模型。不会自动保存其他设置或切换来源。");
      setModels(null);
      await fetchModelsForId(selected);
    });

  const activate = () =>
    operation(async () => {
      if (dirty) throw Error("请先保存此来源，再设为当前来源。");
      if (!source?.model) throw Error("请先选择或输入默认模型并保存。");
      const input: ConfigureInput = { source: { type: "activate", id: source.id } };
      if (!(await updateSettings(input))) throw Error("切换来源失败，未自动重试。");
      if (alive.current)
        setMessage(
          "已切换当前来源。后续请求使用该来源，当前运行不会切换。已有会话请确认模型 ID 在此来源可用。"
        );
    });

  const remove = () =>
    operation(async () => {
      if (!source) return;
      if (!(await updateSettings({ source: { type: "remove", id: source.id } })))
        throw Error("删除来源失败。");
      if (alive.current) {
        setSelected(null);
        setDraft(fresh());
        setBaseline(null);
        setModels(null);
        setConfirmRemove(false);
        setMessage("来源已删除。其他来源不受影响。");
      }
    });

  const toggleSourceExpand = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedSources((old) => {
      const next = !old[id];
      if (next && !sourceModelsCache[id] && !dirty) {
        void operation(async () => {
          await fetchModelsForId(id);
        });
      }
      return { ...old, [id]: next };
    });
  };

  const filteredModels = useMemo(() => {
    if (!models) return [];
    const q = modelSearch.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, modelSearch]);

  return (
    <section className="settings-section" aria-label="模型来源管理">
      <div className="settings-card provider-sources-container">
        <div className="settings-card-header">
          <div className="provider-sources-header-row">
            <div>
              <h3>模型来源</h3>
              <p>分别保存多个服务的地址、密钥与默认模型。点击来源卡片可展开浏览该来源的模型列表与规格。</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={14} />}
              disabled={busy || sources.length >= 20 || hasEdits}
              onClick={() => selectSource(null)}
            >
              添加来源
            </Button>
          </div>
        </div>

        <div className="provider-source-cards-list">
          {sources.map((item) => {
            const isSelected = selected === item.id;
            const isActive = settings?.activeSourceId === item.id;
            const isExpanded = !!expandedSources[item.id];
            const itemModels = sourceModelsCache[item.id] ?? (isSelected ? models : null);
            const modelCount = itemModels?.length;

            return (
              <article
                key={item.id}
                className={`provider-source-card ${isSelected ? "is-selected" : ""} ${
                  isActive ? "is-active-source" : ""
                }`}
              >
                <div className="provider-source-card-top">
                  <button
                    type="button"
                    className="provider-source-row"
                    aria-pressed={isSelected}
                    disabled={busy || hasEdits}
                    onClick={() => selectSource(item.id)}
                  >
                    <div className="provider-source-icon-wrap">
                      <Plugs size={22} weight="duotone" className="provider-source-icon" />
                    </div>
                    <div className="provider-source-info">
                      <div className="provider-source-title-row">
                        <strong>{item.label}</strong>
                        {isActive && (
                          <span className="provider-active">
                            <Check size={14} weight="bold" />
                            当前
                          </span>
                        )}
                        <span className="provider-protocol-badge">
                          {item.apiMode === "responses" ? "Responses" : "Chat Completions"}
                        </span>
                      </div>
                      <small className="provider-source-url">{item.baseUrl}</small>
                      <small className="provider-source-model">
                        {item.model || "尚未选择默认模型"}
                      </small>
                    </div>
                  </button>

                  <div className="provider-source-card-actions">
                    <button
                      type="button"
                      className="provider-source-expand-btn"
                      onClick={(e) => toggleSourceExpand(item.id, e)}
                      title={isExpanded ? "收起模型" : "展开模型"}
                      aria-expanded={isExpanded}
                    >
                      <span>
                        {isExpanded ? "收起模型" : "展开模型"}
                        {modelCount !== undefined ? ` (${modelCount})` : ""}
                      </span>
                      {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    </button>
                    {isSelected ? (
                      <span className="provider-source-editing-badge">
                        <PencilSimple size={13} /> 正在编辑
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || hasEdits}
                        onClick={() => selectSource(item.id)}
                      >
                        编辑配置
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="provider-source-expanded-panel">
                    <div className="expanded-models-header">
                      <div className="expanded-models-title">
                        <SlidersHorizontal size={15} />
                        <span>{item.label} · 模型目录</span>
                        {modelCount !== undefined && (
                          <span className="models-count-tag">{modelCount} 个模型</span>
                        )}
                      </div>
                      <div className="expanded-models-actions">
                        {isSelected && (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<ArrowClockwise size={14} />}
                            disabled={dirty || busy}
                            onClick={() => void fetchModels()}
                          >
                            刷新模型目录
                          </Button>
                        )}
                      </div>
                    </div>

                    {itemModels && itemModels.length > 0 ? (
                      <div className="source-models-grid">
                        {itemModels.map((m) => {
                          const specs = getModelSpecs(
                            m,
                            item.baseUrl,
                            settings?.modelContextWindows
                          );
                          const isDefault = item.model === m || (isSelected && draft.model === m);

                          return (
                            <button
                              key={m}
                              type="button"
                              className={`model-catalog-option source-model-card ${
                                isDefault ? "is-selected-model" : ""
                              }`}
                              aria-pressed={isDefault}
                              title={m}
                              onClick={() => {
                                change({ model: m });
                                if (!isSelected) {
                                  selectSource(item.id);
                                }
                              }}
                            >
                              <div className="source-model-card-header">
                                <div className="source-model-name-group">
                                  <strong>{m.split("/").at(-1)}</strong>
                                  <small className="source-model-full-id">{m}</small>
                                </div>
                                {isDefault && (
                                  <span className="source-model-default-tag">
                                    <Check size={12} weight="bold" /> 默认
                                  </span>
                                )}
                              </div>
                              <div className="source-model-specs">
                                <div className="source-model-spec-row">
                                  <span className="spec-label">
                                    <Cpu size={12} /> 上下文
                                  </span>
                                  <span className="spec-val">{specs.context}</span>
                                </div>
                                <div className="source-model-spec-row">
                                  <span className="spec-label">
                                    <Brain size={12} /> 思考等级
                                  </span>
                                  <span className="spec-val">{specs.reasoning}</span>
                                </div>
                                <div className="source-model-spec-row spec-pricing">
                                  <span className="spec-label">
                                    <CurrencyDollar size={12} /> 参考价格
                                  </span>
                                  <span className="spec-val">{specs.pricing}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="provider-models-empty">
                        <p>尚未从该来源拉取模型列表。</p>
                        {isSelected ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<ArrowClockwise size={14} />}
                            disabled={dirty || busy}
                            onClick={() => void fetchModels()}
                          >
                            从 /models 拉取
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<ArrowClockwise size={14} />}
                            disabled={busy || hasEdits}
                            onClick={() => {
                              selectSource(item.id);
                              void fetchModelsForId(item.id);
                            }}
                          >
                            拉取模型目录
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {!sources.length && (
            <div className="settings-empty">尚无模型来源。添加 OpenAI 或兼容网关、本地服务。</div>
          )}
        </div>
      </div>

      {settings?.environmentOverride && (
        <div className="settings-warning">
          <p>
            检测到 FORGE_* 环境变量覆盖。默认运行可能仍使用环境配置；这里按来源拉取 /models
            使用各来源保存的地址和密钥。
          </p>
        </div>
      )}

      <div className="settings-card provider-edit-card">
        <div className="settings-card-header">
          <h3>{source ? `编辑来源 · ${source.label}` : "新增来源"}</h3>
          <p>来源独立保存，不受底部“保存设置”影响。切换编辑项前请保存或放弃此来源修改。</p>
        </div>
        <form
          className="settings-card-body"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void operation(persist);
          }}
        >
          <fieldset className="provider-source-fields" disabled={busy || !settings}>
            <Field id="source-label" label="来源名称">
              <Input
                id="source-label"
                value={draft.label}
                placeholder="例如 OpenAI、公司网关、本地模型"
                onChange={(e) => change({ label: e.target.value })}
              />
            </Field>
            <Field
              id="source-url"
              label="API 地址"
              helper="填写基础地址，例如 https://api.openai.com/v1。模型目录请求为该地址 + /models，不要填写 /chat/completions。"
            >
              <Input
                id="source-url"
                value={draft.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => change({ baseUrl: e.target.value })}
              />
            </Field>
            <Field id="source-protocol" label="协议">
              <Input
                id="source-protocol"
                readOnly
                value={
                  draft.apiMode === "responses"
                    ? "OpenAI Responses（保留旧配置）"
                    : "OpenAI Chat Completions"
                }
              />
            </Field>
            {draft.apiMode === "responses" && (
              <Button size="sm" onClick={() => change({ apiMode: "chat-completions" })}>
                改用 OpenAI Chat Completions
              </Button>
            )}
            <Field
              id="source-key"
              label="来源 API 密钥"
              helper={
                source?.hasApiKey
                  ? "此来源已保存密钥，留空保留；不回显原文。"
                  : "仅用于此来源，本地无鉴权服务可留空。"
              }
            >
              <Input
                id="source-key"
                type="password"
                autoComplete="new-password"
                value={draft.key}
                disabled={draft.removeKey}
                onChange={(e) => change({ key: e.target.value })}
              />
            </Field>
            {source?.hasApiKey && (
              <label className="settings-check settings-danger-check">
                <input
                  type="checkbox"
                  checked={draft.removeKey}
                  onChange={(e) => change({ removeKey: e.target.checked, key: "" })}
                />
                <span>保存时清除此来源密钥</span>
              </label>
            )}
            <Field
              id="source-model"
              label="默认模型 ID"
              helper="可以先留空保存来源，再通过 /models 拉取并选择模型；目录不可用时也可手动输入。"
            >
              <Input
                id="source-model"
                value={draft.model}
                placeholder="例如 deepseek-chat 或 gpt-4o"
                onChange={(e) => change({ model: e.target.value })}
              />
            </Field>

            <div className="provider-source-actions">
              <Button type="submit" variant="primary" disabled={!dirty}>
                保存来源
              </Button>
              <Button disabled={!dirty} onClick={() => selectSource(selected)}>
                放弃此来源修改
              </Button>
              <Button
                icon={<ArrowClockwise size={14} />}
                disabled={!selected || dirty}
                onClick={() => void fetchModels()}
              >
                从 /models 拉取
              </Button>
            </div>

            {source && (
              <div className="provider-source-actions provider-source-footer-actions">
                <Button
                  disabled={
                    dirty ||
                    !source.model ||
                    settings?.activeSourceId === source.id ||
                    settings?.environmentOverride
                  }
                  onClick={() => void activate()}
                >
                  {settings?.activeSourceId === source.id ? "正在使用此来源" : "设为当前来源"}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Trash size={14} />}
                  disabled={settings?.activeSourceId === source.id}
                  onClick={() => setConfirmRemove(true)}
                >
                  删除来源
                </Button>
              </div>
            )}

            {source && settings?.activeSourceId === source.id && (
              <small className="provider-active-hint">
                当前来源不能删除，请先切换到其他来源。切换影响桌面与 CLI 后续请求，不自动回退。
              </small>
            )}

            {confirmRemove && (
              <div className="settings-warning">
                <p>删除“{source?.label}”及其保存的密钥？此操作不可撤销。</p>
                <div className="provider-confirm-remove-actions">
                  <Button variant="danger" onClick={() => void remove()}>
                    确认删除来源
                  </Button>
                  <Button onClick={() => setConfirmRemove(false)}>取消删除</Button>
                </div>
              </div>
            )}
          </fieldset>

          {busy && <p role="status" className="provider-status-msg">正在处理来源…</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {message && <p role="status" className="provider-status-msg provider-success-msg">{message}</p>}
        </form>
      </div>
    </section>
  );
}
