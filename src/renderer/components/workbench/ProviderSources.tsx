import { useEffect, useRef, useState } from "react";
import { Plus, Plugs, Check, Trash, ArrowClockwise } from "@phosphor-icons/react";
import { configureInputSchema, type ConfigureInput } from "../../../shared/schemas";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { ModelCatalog } from "./ModelCatalog";
import "./provider-sources.css";

type Draft = { id: string; label: string; baseUrl: string; model: string; apiMode: "chat-completions" | "responses"; key: string; removeKey: boolean };
const fresh = (): Draft => ({ id: `source-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`, label: "", baseUrl: "", model: "", apiMode: "chat-completions", key: "", removeKey: false });
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
  const lock = useRef(false);
  const alive = useRef(true);
  const source = sources.find(item => item.id === selected);
  const dirty = !baseline || JSON.stringify(draft) !== JSON.stringify(baseline);
  const hasEdits = baseline ? dirty : !!(draft.label || draft.baseUrl || draft.model || draft.key || draft.removeKey);
  const selectSource = (id: string | null) => {
    const saved = sources.find(item => item.id === id);
    const next: Draft = saved ? { id: saved.id, label: saved.label, baseUrl: saved.baseUrl, model: saved.model, apiMode: saved.apiMode ?? "chat-completions", key: "", removeKey: false } : fresh();
    setSelected(saved?.id ?? null); setDraft(next); setBaseline(saved ? next : null);
    setModels(null); setError(""); setMessage(""); setConfirmRemove(false);
  };
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !settings) return;
    initialized.current = true;
    selectSource(settings.activeSourceId ?? sources[0]?.id ?? null);
  }, [settings]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const change = (patch: Partial<Draft>) => { setDraft(old => ({ ...old, ...patch })); setError(""); setMessage(""); };
  const operation = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError(""); setMessage("");
    try { await fn(); }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "操作失败，未自动重试。"); }
    finally { lock.current = false; onBusy(false); if (alive.current) setBusy(false); }
  };
  const persist = async () => {
    // Updating an endpoint must never silently send the old credential to a different server.
    if (source?.hasApiKey && draft.baseUrl !== source.baseUrl && !draft.key && !draft.removeKey)
      throw Error("修改 API 地址时，请重新填写密钥或勾选清除旧密钥，避免把旧密钥发送到新来源。");
    const { key, removeKey, ...profile } = draft;
    const input = configureInputSchema.parse({ source: { type: "save", source: profile, ...(removeKey ? { apiKey: "" } : key ? { apiKey: key } : {}) } });
    if (!await updateSettings(input)) throw Error("来源保存失败，输入已保留。请检查地址与配置后重试。");
    if (!alive.current) return;
    const saved = { ...draft, key: "", removeKey: false };
    setSelected(saved.id); setDraft(saved); setBaseline(saved); setModels(null); setMessage("来源已保存，可以从 /models 拉取模型。");
  };
  const fetchModels = () => operation(async () => {
    if (!selected || dirty) throw Error("请先保存此来源，再拉取模型。不会自动保存其他设置或切换来源。");
    setModels(null);
    const result = await window.forge.listModels(selected);
    if (alive.current) { setModels(result); setMessage(result.length ? `已从此来源 /models 拉取 ${result.length} 个模型。选择后请保存来源。` : "此来源返回空模型目录。可检查服务配置，或手动输入精确模型 ID。"); }
  });
  const activate = () => operation(async () => {
    if (dirty) throw Error("请先保存此来源，再设为当前来源。");
    if (!source?.model) throw Error("请先选择或输入默认模型并保存。");
    const input: ConfigureInput = { source: { type: "activate", id: source.id } };
    if (!await updateSettings(input)) throw Error("切换来源失败，未自动重试。");
    if (alive.current) setMessage("已切换当前来源。后续请求使用该来源，当前运行不会切换。已有会话请确认模型 ID 在此来源可用。");
  });
  const remove = () => operation(async () => {
    if (!source) return;
    if (!await updateSettings({ source: { type: "remove", id: source.id } })) throw Error("删除来源失败。");
    if (alive.current) { setSelected(null); setDraft(fresh()); setBaseline(null); setModels(null); setConfirmRemove(false); setMessage("来源已删除。其他来源不受影响。"); }
  });
  return <section className="settings-section" aria-label="模型来源管理">
    <div className="settings-card">
      <div className="settings-card-header"><h3>模型来源</h3><p>分别保存多个服务的地址、密钥与默认模型。目前仅支持 OpenAI 兼容协议，新增来源使用 Chat Completions。</p></div>
      <div className="provider-source-list">
        {sources.map(item => <button type="button" key={item.id} className="provider-source-row" aria-pressed={selected === item.id} disabled={busy || hasEdits} onClick={() => selectSource(item.id)}>
          <Plugs size={20} /><span><strong>{item.label}</strong><small>{item.baseUrl}</small><small>{item.model || "尚未选择默认模型"}</small></span>
          {settings?.activeSourceId === item.id && <span className="provider-active"><Check size={14} />当前</span>}
        </button>)}
        {!sources.length && <p className="settings-empty">尚无模型来源。添加 OpenAI 或兼容网关、本地服务。</p>}
        <Button size="sm" icon={<Plus size={14} />} disabled={busy || sources.length >= 20 || hasEdits} onClick={() => selectSource(null)}>添加来源</Button>
      </div>
    </div>
    {settings?.environmentOverride && <p className="settings-warning">检测到 FORGE_* 环境变量覆盖。默认运行可能仍使用环境配置；这里按来源拉取 /models 使用各来源保存的地址和密钥。</p>}
    <div className="settings-card">
      <div className="settings-card-header"><h3>{source ? `编辑来源 · ${source.label}` : "新增来源"}</h3><p>来源独立保存，不受底部“保存设置”影响。切换编辑项前请保存或放弃此来源修改。</p></div>
      <form className="settings-card-body" noValidate onSubmit={event => { event.preventDefault(); void operation(persist); }}>
        <fieldset className="provider-source-fields" disabled={busy || !settings}>
          <Field id="source-label" label="来源名称"><Input id="source-label" value={draft.label} placeholder="例如 OpenAI、公司网关、本地模型" onChange={e => change({ label: e.target.value })} /></Field>
          <Field id="source-url" label="API 地址" helper="填写基础地址，例如 https://api.openai.com/v1。模型目录请求为该地址 + /models，不要填写 /chat/completions。"><Input id="source-url" value={draft.baseUrl} placeholder="https://api.openai.com/v1" onChange={e => change({ baseUrl: e.target.value })} /></Field>
          <Field id="source-protocol" label="协议"><Input id="source-protocol" readOnly value={draft.apiMode === "responses" ? "OpenAI Responses（保留旧配置）" : "OpenAI Chat Completions"} /></Field>
          {draft.apiMode === "responses" && <Button size="sm" onClick={() => change({ apiMode: "chat-completions" })}>改用 OpenAI Chat Completions</Button>}
          <Field id="source-key" label="来源 API 密钥" helper={source?.hasApiKey ? "此来源已保存密钥，留空保留；不回显原文。" : "仅用于此来源，本地无鉴权服务可留空。"}><Input id="source-key" type="password" autoComplete="new-password" value={draft.key} disabled={draft.removeKey} onChange={e => change({ key: e.target.value })} /></Field>
          {source?.hasApiKey && <label className="settings-check"><input type="checkbox" checked={draft.removeKey} onChange={e => change({ removeKey: e.target.checked, key: "" })} />保存时清除此来源密钥</label>}
          <Field id="source-model" label="默认模型 ID" helper="可以先留空保存来源，再通过 /models 拉取并选择模型；目录不可用时也可手动输入。"><Input id="source-model" value={draft.model} onChange={e => change({ model: e.target.value })} /></Field>
          <div className="provider-source-actions"><Button type="submit" variant="primary" disabled={!dirty}>保存来源</Button><Button disabled={!dirty} onClick={() => selectSource(selected)}>放弃此来源修改</Button><Button icon={<ArrowClockwise size={14} />} disabled={!selected || dirty} onClick={() => void fetchModels()}>从 /models 拉取</Button></div>
          {models && <ModelCatalog value={draft.model} models={models} onSelect={model => change({ model })} onRefresh={() => void fetchModels()} loading={busy} error="" />}
          {source && <div className="provider-source-actions"><Button disabled={dirty || !source.model || settings?.activeSourceId === source.id || settings?.environmentOverride} onClick={() => void activate()}>{settings?.activeSourceId === source.id ? "正在使用此来源" : "设为当前来源"}</Button><Button variant="ghost" icon={<Trash size={14} />} disabled={settings?.activeSourceId === source.id} onClick={() => setConfirmRemove(true)}>删除来源</Button></div>}
          {source && settings?.activeSourceId === source.id && <small>当前来源不能删除，请先切换到其他来源。切换影响桌面与 CLI 后续请求，不自动回退。</small>}
          {confirmRemove && <div className="settings-warning"><p>删除“{source?.label}”及其保存的密钥？此操作不可撤销。</p><Button variant="danger" onClick={() => void remove()}>确认删除来源</Button><Button onClick={() => setConfirmRemove(false)}>取消删除</Button></div>}
        </fieldset>
        {busy && <p role="status">正在处理来源…</p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        {message && <p role="status">{message}</p>}
      </form>
    </div>
  </section>;
}
