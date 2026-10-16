import { ArrowUp, CaretDown, FolderOpen, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { permissionSchema, settingsFields } from "../../../shared/schemas";
import type { SessionId } from "../../shared-types";
import { parseDrafts } from "../../state/drafts";
import { useWorkbench } from "../../state/workbench-context";
import { hostCapabilities } from "../../web-host";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";

const taskSchema = z.object({
  workspace: z.string().trim().min(1, "请选择一个工作区").max(4096).refine(
    (s) => s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\"),
    "请输入绝对工作区路径",
  ),
  model: settingsFields.model,
  prompt: z.string().trim().min(1).max(1000000),
});
const shortPermission = { readonly: "只读", workspace: "工作区", unrestricted: "无限制" } as const;
function shortModelName(model: string): string {
  const leaf = model.trim().split("/").filter(Boolean).at(-1) ?? "未选择模型";
  return leaf.length > 28 ? `${leaf.slice(0, 27)}…` : leaf;
}
function readDrafts(): Readonly<Record<string, string>> {
  try {
    return { ...parseDrafts(sessionStorage.getItem("forge-composer-drafts")), new: parseDrafts(sessionStorage.getItem("forge-new-task-draft")).new ?? "" };
  } catch { return {}; }
}

export function Composer({ isNew = false }: { readonly isNew?: boolean }) {
  const { state, startRun, createSession, selectSession, chooseWorkspace, cancelRun, openSettings } = useWorkbench();
  // Keep one composer mounted across new/history views; drafts never migrate to another session.
  const [drafts, setDrafts] = useState(readDrafts);
  useEffect(() => {
    try {
      const { new: fresh, ...sessions } = drafts;
      sessionStorage.setItem("forge-composer-drafts", JSON.stringify(sessions));
      sessionStorage.setItem("forge-new-task-draft", JSON.stringify({ new: fresh ?? "" }));
    } catch { /* draft remains available in memory */ }
  }, [drafts]);
  const draftId = isNew ? "new" : (state.activeSessionId ?? "none");
  const prompt = drafts[draftId] ?? "";
  const promptId = isNew ? "new-prompt" : `prompt-${draftId}`;
  const selectedDraft = useRef(draftId);
  selectedDraft.current = draftId;
  const [workspace, setWorkspace] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const defaultWorkspace = state.activeSnapshot?.workspace ?? state.sessions[0]?.workspace ?? "";
  useEffect(() => {
    if (!isNew) return;
    if (hostCapabilities.web) {
      let cancelled = false;
      void window.forge.chooseWorkspace().then((path) => {
        if (!cancelled && path) setWorkspace(path);
      }).catch(() => {});
      return () => { cancelled = true; };
    }
    if (defaultWorkspace) setWorkspace(defaultWorkspace);
  }, [isNew, defaultWorkspace]);
  useEffect(() => {
    if (isNew && !state.isSettingsOpen) promptRef.current?.focus();
  }, [isNew, state.isNewSessionOpen, state.isSettingsOpen]);
  const [modelsByDraft, setModelsByDraft] = useState<Record<string, string>>({});
  const model = modelsByDraft[draftId] ?? (isNew ? state.settings?.model : state.activeSnapshot?.model) ?? state.settings?.model ?? "";
  const setModel = (value: string) => setModelsByDraft((old) => ({ ...old, [draftId]: value }));
  const [availableModels, setAvailableModels] = useState<readonly string[]>([]);
  const [modelError, setModelError] = useState("");
  const [listing, setListing] = useState(false);
  const [permission, setPermission] = useState(state.settings?.defaultPermission ?? "workspace");
  const permissionTouched = useRef(false);
  useEffect(() => {
    if (!permissionTouched.current && state.settings) setPermission(state.settings.defaultPermission);
  }, [state.settings]);
  const [submission, setSubmission] = useState<{ id: SessionId; draftId: string; prompt: string } | null>(null);
  useEffect(() => {
    if (!submission) return;
    const submittedRun = state.activeRuns[submission.id];
    if (!submittedRun?.accepted) {
      if (!submittedRun || !["running", "awaiting_approval"].includes(submittedRun.status)) {
        setSubmission(null);
        setError("消息未被接收，草稿已保留。请检查错误详情后重试。");
      }
      return;
    }
    setDrafts((old) => old[submission.draftId] === submission.prompt ? { ...old, [submission.draftId]: "" } : old);
    setSubmission(null);
    if (submission.draftId === "new") pendingNew.current = null;
    // Do not steal navigation if the user opened a different session while starting.
    if (submission.draftId === "new" && selectedDraft.current === "new") void selectSession(submission.id);
  }, [submission, state.activeRuns, selectSession]);
  const [mode, setMode] = useState<"build" | "plan">("build");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const pendingNew = useRef<{ id: SessionId; workspace: string; model: string } | null>(null);
  const [error, setError] = useState("");
  const [confirmRequested, setConfirmRequested] = useState(false);
  const [unrestrictedConsent, setUnrestrictedConsent] = useState(false);
  const revokeUnrestrictedConsent = () => { setUnrestrictedConsent(false); setConfirmRequested(false); };
  useEffect(() => {
    setError("");
    setUnrestrictedConsent(false);
    setConfirmRequested(false);
  }, [draftId]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = !isNew && state.activeSessionId ? state.activeRuns[state.activeSessionId] : undefined;
  const running = run?.status === "running" || run?.status === "awaiting_approval";
  const changeMode = (next: "build" | "plan") => { setMode(next); revokeUnrestrictedConsent(); };
  const isConfigured = state.settings?.isConfigured === true;
  const configurationHint = "连接模型后即可开始对话。";
  const submit = async () => {
    if (submitting.current || running || submission) return;
    if (!isConfigured) { setError(configurationHint); return; }
    if (permission === "unrestricted" && mode !== "plan" && !unrestrictedConsent) {
      setConfirmRequested(true); setError("无限制权限需要先确认。"); return;
    }
    const parsed = taskSchema.safeParse({ workspace: isNew ? workspace : state.activeSnapshot?.workspace, model, prompt });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join("；"));
      if (!workspace && isNew) setWorkspaceOpen(true);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    let id = isNew ? null : state.activeSessionId;
    if (isNew) {
      const pending = pendingNew.current;
      if (pending && pending.workspace === parsed.data.workspace && pending.model === parsed.data.model) id = pending.id;
      else {
        const snapshot = await createSession({ workspace: parsed.data.workspace, model: parsed.data.model }, false);
        id = snapshot?.id ?? null;
        if (id) pendingNew.current = { id, workspace: parsed.data.workspace, model: parsed.data.model };
      }
    }
    const ok = id ? await startRun(parsed.data.prompt, mode === "plan" ? "readonly" : permission, parsed.data.model, id, mode) : false;
    submitting.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (ok && id) {
      setSubmission({ id, draftId, prompt });
      revokeUnrestrictedConsent();
    } else if (selectedDraft.current === draftId) setError("未能开始对话，草稿已保留。请检查错误详情后重试。");
  };
  const listModels = async () => {
    if (listing) return;
    setListing(true); setModelError("");
    try { const models = await window.forge.listModels(); if (alive.current) setAvailableModels(models); }
    catch (err) { if (alive.current) setModelError(err instanceof Error ? err.message : "模型列表读取失败"); }
    finally { if (alive.current) setListing(false); }
  };
  return (
    <form className={`workbench-composer composer${isNew ? " composer-fresh" : ""}`} aria-label={isNew ? "新会话输入" : "任务输入"} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {isNew && (
        <div className="composer-project">
          <button type="button" className="composer-project-trigger" title={workspace || "选择项目目录"} onClick={() => setWorkspaceOpen(!workspaceOpen)} aria-expanded={workspaceOpen}>
            <FolderOpen size={15} aria-hidden="true" />
            <span>{workspace ? workspace.split(/[\\/]/).filter(Boolean).at(-1) : "选择工作区"}</span>
            <CaretDown size={12} aria-hidden="true" />
          </button>
          {workspaceOpen && (
            <div className="composer-project-panel">
              <Field id="workspace-path" label={hostCapabilities.web ? "服务器工作区" : "工作区"} helper={hostCapabilities.web ? "此 Web 服务固定使用这个项目。" : "默认沿用当前项目，也可以输入其他绝对路径。"}>
                <div className="composer-workspace-row">
                  <Input id="workspace-path" value={workspace} readOnly={hostCapabilities.web} onChange={(event) => setWorkspace(event.target.value)} />
                  {!hostCapabilities.web && <Button type="button" variant="ghost" onClick={async () => { const path = await chooseWorkspace(); if (path && alive.current) setWorkspace(path); }}>选择目录</Button>}
                </div>
              </Field>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setWorkspaceOpen(false); promptRef.current?.focus(); }}>完成</Button>
            </div>
          )}
        </div>
      )}
      <div className="composer-inner composer-surface">
        <div className="composer-prompt is-quiet">
          <label htmlFor={promptId} className="visually-hidden">{isNew ? "新会话消息" : "继续任务"}</label>
          <span className={`composer-mode-arrow is-${mode}`} aria-hidden="true">❯</span>
          <span className="visually-hidden" aria-live="polite">{`Mode: ${mode}${running || busy ? "；仅影响下一次运行，当前运行模式不变" : ""}`}</span>
          <textarea id={promptId} ref={promptRef} className="composer-textarea" value={prompt} rows={isNew ? 4 : 2} placeholder={isNew ? "想做点什么？" : "描述要完成的工作…"}
            onChange={(event) => { revokeUnrestrictedConsent(); setDrafts((old) => ({ ...old, [draftId]: event.target.value })); }}
            onKeyDown={(event) => {
              if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && !document.querySelector("dialog[open]")) {
                event.preventDefault(); changeMode(mode === "build" ? "plan" : "build"); return;
              }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            }} />
        </div>
        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
            <div className="composer-pill composer-field composer-mode">
              <label className="visually-hidden" htmlFor="run-mode">模式</label>
              <Select id="run-mode" className="composer-compact-select" aria-label="模式" value={mode} onChange={(event) => changeMode(z.enum(["build", "plan"]).parse(event.target.value))} options={[{ value: "build", label: "Build" }, { value: "plan", label: "Plan" }]} />
            </div>
            <div className="composer-pill composer-field composer-permission">
              <label className="visually-hidden" htmlFor="run-permission">权限</label>
              <Select id="run-permission" className="composer-compact-select" aria-label="权限" value={mode === "plan" ? "readonly" : permission} disabled={mode === "plan"} onChange={(event) => {
                permissionTouched.current = true; setPermission(permissionSchema.parse(event.target.value)); revokeUnrestrictedConsent();
              }} options={Object.entries(shortPermission).map(([value, label]) => ({ value, label: value === "unrestricted" ? `${label} · 需确认` : label }))} />
            </div>
          </div>
          <div className="composer-toolbar-end">
            <details className="composer-model composer-model-picker" onToggle={(event) => { if (event.currentTarget.open) queueMicrotask(() => document.getElementById("run-model")?.focus()); }} onKeyDown={(event) => {
              if (event.key !== "Escape" || !event.currentTarget.open) return;
              event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus();
            }}>
              <summary className="composer-model-summary" title={model || "尚未选择模型"}>
                <span className="composer-model-kicker">模型</span><span className="composer-model-name composer-model-short">{shortModelName(model)}</span><CaretDown size={12} aria-hidden="true" />
              </summary>
              <div className="composer-model-panel">
                <Field id="run-model" label="精确模型 ID" helper="选择目录中的模型，或输入完整 ID。" error={modelError || undefined}>
                  <Input id="run-model" list="run-model-options" aria-label="模型 ID" value={model} onChange={(event) => setModel(event.target.value)} placeholder={state.settings?.model || "provider/model"} />
                  <datalist id="run-model-options">{availableModels.map((id) => <option key={id} value={id} />)}</datalist>
                </Field>
                {model && <p className="composer-model-id composer-model-full" title={model}>当前完整 ID：{model}</p>}
                <Button type="button" size="sm" variant="ghost" loading={listing} onClick={() => void listModels()}>{listing ? "正在读取目录…" : "读取可用模型"}</Button>
              </div>
            </details>
            {running ? (
              <Button type="button" variant="danger" size="sm" className="composer-cancel" loading={Boolean(run?.isCancelling)} onClick={() => void cancelRun()}><Stop size={14} aria-hidden="true" />{run?.isCancelling ? "正在取消…" : "取消"}</Button>
            ) : (
              <Button type="submit" variant="primary" size="sm" className="composer-submit composer-run" loading={busy || !!submission} disabled={!isConfigured || !prompt.trim() || !!submission} aria-label={isNew ? "发送并开始会话" : "运行"} title="发送 · Ctrl/Cmd + Enter"><ArrowUp size={16} weight="bold" aria-hidden="true" /></Button>
            )}
          </div>
        </div>
        {(!isConfigured || mode === "plan" || busy || error || confirmRequested) && (
          <div className="composer-status" aria-live="polite">
            {!isConfigured && <span className="wb-muted">{configurationHint} <Button type="button" size="sm" variant="ghost" onClick={() => openSettings(true)}>配置模型</Button></span>}
            {mode === "plan" && <span className="wb-muted composer-plan-note">规划模式只读，不执行修改或 MCP 操作。</span>}
            {busy && <span className="composer-busy">正在提交…</span>}
            {error && <span role="alert" className="form-error composer-error">{error}</span>}
            {confirmRequested && mode !== "plan" && <span className="composer-confirm">无限制允许执行命令，且不是操作系统沙箱。<Button type="button" size="sm" variant="danger" onClick={(event) => {
              event.preventDefault(); event.stopPropagation(); setUnrestrictedConsent(true); setConfirmRequested(false); setError("");
            }}>我已理解并确认无限制</Button></span>}
          </div>
        )}
      </div>
    </form>
  );
}
