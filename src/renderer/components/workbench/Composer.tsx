import {
  ArrowUp,
  Brain,
  CaretDown,
  FolderOpen,
  Lightning,
  ShieldCheck,
  Stop,
} from "@phosphor-icons/react";
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
import { ComposerDropdown } from "./ComposerDropdown";
import { ModelPicker } from "./ModelPicker";
import { UsagePopover } from "./UsagePopover";
import { useAutosizePrompt } from "./useAutosizePrompt";

const taskSchema = z.object({
  workspace: z
    .string()
    .trim()
    .min(1, "请选择一个工作区")
    .max(4096)
    .refine(
      (s) =>
        s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\"),
      "请输入绝对工作区路径",
    ),
  model: settingsFields.model,
  prompt: z.string().trim().min(1).max(1000000),
});
function readDrafts(): Readonly<Record<string, string>> {
  try {
    return {
      ...parseDrafts(sessionStorage.getItem("forge-composer-drafts")),
      new:
        parseDrafts(sessionStorage.getItem("forge-new-task-draft")).new ?? "",
    };
  } catch {
    return {};
  }
}

export function Composer({ isNew = false }: { readonly isNew?: boolean }) {
  const {
    state,
    startRun,
    createSession,
    selectSession,
    chooseWorkspace,
    cancelRun,
    setRunPermission,
    openSettings,
    updateSettings,
  } = useWorkbench();
  // Keep one composer mounted across new/history views; drafts never migrate to another session.
  const [drafts, setDrafts] = useState(readDrafts);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [manualDrafts, setManualDrafts] = useState<
    Readonly<Record<string, boolean>>
  >({});
  useEffect(() => {
    try {
      const { new: fresh, ...sessions } = drafts;
      sessionStorage.setItem("forge-composer-drafts", JSON.stringify(sessions));
      sessionStorage.setItem(
        "forge-new-task-draft",
        JSON.stringify({ new: fresh ?? "" }),
      );
    } catch {
      /* draft remains available in memory */
    }
  }, [drafts]);
  const draftId = isNew ? "new" : (state.activeSessionId ?? "none");
  const prompt = drafts[draftId] ?? "";
  const manualSend = Boolean(manualDrafts[draftId]) || /[\r\n]/.test(prompt);
  const promptId = isNew ? "new-prompt" : `prompt-${draftId}`;
  const selectedDraft = useRef(draftId);
  selectedDraft.current = draftId;
  const [workspace, setWorkspace] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useAutosizePrompt(promptRef, prompt);
  useEffect(() => {
    if (/[\r\n]/.test(prompt))
      setManualDrafts((old) =>
        old[draftId] ? old : { ...old, [draftId]: true },
      );
  }, [draftId, prompt]);
  const defaultWorkspace =
    state.activeSnapshot?.workspace ?? state.sessions[0]?.workspace ?? "";
  useEffect(() => {
    if (!isNew) return;
    if (hostCapabilities.web) {
      let cancelled = false;
      void window.forge
        .chooseWorkspace()
        .then((path) => {
          if (!cancelled && path) setWorkspace(path);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    if (defaultWorkspace) setWorkspace(defaultWorkspace);
  }, [isNew, defaultWorkspace]);
  useEffect(() => {
    if (isNew && !state.isSettingsOpen) promptRef.current?.focus();
  }, [isNew, state.isSettingsOpen]);
  const [modelsByDraft, setModelsByDraft] = useState<Record<string, string>>(
    {},
  );
  const model =
    modelsByDraft[draftId] ??
    (isNew ? state.settings?.model : state.activeSnapshot?.model) ??
    state.settings?.model ??
    "";
  const setModel = (value: string) =>
    setModelsByDraft((old) => ({ ...old, [draftId]: value }));
  const [availableModels, setAvailableModels] = useState<readonly string[]>([]);
  const [modelError, setModelError] = useState("");
  const [listing, setListing] = useState(false);
  const [savingEffort, setSavingEffort] = useState(false);
  const effortSaving = useRef(false);
  const changeEffort = async (value: string) => {
    if (effortSaving.current) return;
    const reasoningEffort = settingsFields.reasoningEffort
      .unwrap()
      .parse(value);
    effortSaving.current = true;
    setSavingEffort(true);
    setError("");
    try {
      const ok = await updateSettings({ settings: { reasoningEffort } });
      if (!ok && alive.current) setError("思考等级保存失败，请重试。");
    } catch {
      if (alive.current) setError("思考等级保存失败，请重试。");
    } finally {
      effortSaving.current = false;
      if (alive.current) setSavingEffort(false);
    }
  };
  const [permission, setPermission] = useState(
    state.settings?.defaultPermission ?? "workspace",
  );
  const permissionTouched = useRef(false);
  useEffect(() => {
    if (!permissionTouched.current && state.settings)
      setPermission(state.settings.defaultPermission);
  }, [state.settings]);
  const [submission, setSubmission] = useState<{
    id: SessionId;
    draftId: string;
    prompt: string;
  } | null>(null);
  useEffect(() => {
    if (!submission) return;
    const submittedRun = state.activeRuns[submission.id];
    if (!submittedRun?.accepted) {
      if (
        !submittedRun ||
        !["running", "awaiting_approval"].includes(submittedRun.status)
      ) {
        setSubmission(null);
        setError("消息未被接收，草稿已保留。请检查错误详情后重试。");
      }
      return;
    }
    if (draftsRef.current[submission.draftId] === submission.prompt) {
      setManualDrafts((old) => ({ ...old, [submission.draftId]: false }));
    }
    setDrafts((old) =>
      old[submission.draftId] === submission.prompt
        ? { ...old, [submission.draftId]: "" }
        : old,
    );
    setSubmission(null);
    if (submission.draftId === "new") pendingNew.current = null;
    // Do not steal navigation if the user opened a different session while starting.
    if (submission.draftId === "new" && selectedDraft.current === "new")
      void selectSession(submission.id);
  }, [submission, state.activeRuns, selectSession]);
  const [mode, setMode] = useState<"build" | "plan">("build");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const pendingNew = useRef<{
    id: SessionId;
    workspace: string;
    model: string;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!draftId) return;
    setError("");
  }, [draftId]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run =
    !isNew && state.activeSessionId
      ? state.activeRuns[state.activeSessionId]
      : undefined;
  const running =
    run?.status === "running" || run?.status === "awaiting_approval";
  const [changingPermission, setChangingPermission] = useState(false);
  const changePermission = async (next: string) => {
    const selected = permissionSchema.parse(next);
    if (changingPermission) return;
    if (running) {
      setChangingPermission(true);
      const ok = await setRunPermission(selected);
      if (alive.current) setChangingPermission(false);
      if (!ok) return;
    }
    if (!alive.current || selectedDraft.current !== draftId) return;
    permissionTouched.current = true;
    setPermission(selected);
  };
  const displayedPermission = running
    ? (run?.permission ?? permission)
    : permission;
  const changeMode = (next: "build" | "plan") => {
    setMode(next);
  };
  const isConfigured = state.settings?.isConfigured === true;
  const configurationHint = "连接模型后即可开始对话。";
  const submit = async () => {
    if (submitting.current || effortSaving.current || running || submission)
      return;
    if (!isConfigured) {
      setError(configurationHint);
      return;
    }
    const parsed = taskSchema.safeParse({
      workspace: isNew ? workspace : state.activeSnapshot?.workspace,
      model,
      prompt,
    });
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
      if (
        pending &&
        pending.workspace === parsed.data.workspace &&
        pending.model === parsed.data.model
      )
        id = pending.id;
      else {
        const snapshot = await createSession(
          { workspace: parsed.data.workspace, model: parsed.data.model },
          false,
        );
        id = snapshot?.id ?? null;
        if (id)
          pendingNew.current = {
            id,
            workspace: parsed.data.workspace,
            model: parsed.data.model,
          };
      }
    }
    const ok = id
      ? await startRun(
          parsed.data.prompt,
          mode === "plan" ? "readonly" : permission,
          parsed.data.model,
          id,
          mode,
        )
      : false;
    submitting.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (ok && id) {
      setSubmission({ id, draftId, prompt });
    } else if (selectedDraft.current === draftId)
      setError("未能开始对话，草稿已保留。请检查错误详情后重试。");
  };
  const listModels = async () => {
    if (listing) return;
    setListing(true);
    setModelError("");
    try {
      const models = await window.forge.listModels();
      if (alive.current) setAvailableModels(models);
    } catch (err) {
      if (alive.current)
        setModelError(err instanceof Error ? err.message : "模型列表读取失败");
    } finally {
      if (alive.current) setListing(false);
    }
  };
  return (
    <form
      className={`workbench-composer composer${isNew ? " composer-fresh" : ""}`}
      aria-label={isNew ? "新会话输入" : "任务输入"}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {isNew && (
        <div className="composer-project">
          <button
            type="button"
            className="composer-project-trigger"
            title={workspace || "选择项目目录"}
            onClick={() => setWorkspaceOpen(!workspaceOpen)}
            aria-expanded={workspaceOpen}
          >
            <FolderOpen size={15} aria-hidden="true" />
            <span>
              {workspace
                ? workspace.split(/[\\/]/).filter(Boolean).at(-1)
                : "选择工作区"}
            </span>
            <CaretDown size={12} aria-hidden="true" />
          </button>
          {workspaceOpen && (
            <div className="composer-project-panel">
              <Field
                id="workspace-path"
                label={hostCapabilities.web ? "服务器工作区" : "工作区"}
                helper={
                  hostCapabilities.web
                    ? "此 Web 服务固定使用这个项目。"
                    : "默认沿用当前项目，也可以输入其他绝对路径。"
                }
              >
                <div className="composer-workspace-row">
                  <Input
                    id="workspace-path"
                    value={workspace}
                    readOnly={hostCapabilities.web}
                    onChange={(event) => setWorkspace(event.target.value)}
                  />
                  {!hostCapabilities.web && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={async () => {
                        const path = await chooseWorkspace();
                        if (path && alive.current) setWorkspace(path);
                      }}
                    >
                      选择目录
                    </Button>
                  )}
                </div>
              </Field>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWorkspaceOpen(false);
                  promptRef.current?.focus();
                }}
              >
                完成
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="composer-inner composer-split">
        <div className="composer-prompt composer-surface is-quiet">
          <label htmlFor={promptId} className="visually-hidden">
            {isNew ? "新会话消息" : "继续任务"}
          </label>
          <span
            className={`composer-mode-arrow is-${mode}`}
            aria-hidden="true"
          />
          <span
            className="visually-hidden"
            aria-live="polite"
          >{`Mode: ${mode}${running || busy ? "；仅影响下一次运行，当前运行模式不变" : ""}`}</span>
          <textarea
            id={promptId}
            ref={promptRef}
            className="composer-textarea"
            value={prompt}
            rows={1}
            placeholder={
              isNew
                ? "想让 Forge 做点什么？输入任务描述或提问…"
                : "继续对话，或描述要执行的工作…"
            }
            title={
              manualSend
                ? "多行模式：Enter 换行，点击发送"
                : "Enter 发送，Shift+Enter 换行"
            }
            onChange={(event) => {
              setDrafts((old) => ({ ...old, [draftId]: event.target.value }));
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Tab" &&
                event.shiftKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !event.nativeEvent.isComposing &&
                !document.querySelector("dialog[open]")
              ) {
                event.preventDefault();
                changeMode(mode === "build" ? "plan" : "build");
                return;
              }
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                if (event.ctrlKey || event.metaKey || event.altKey) {
                  event.preventDefault();
                  return;
                }
                if (event.shiftKey) {
                  setManualDrafts((old) => ({ ...old, [draftId]: true }));
                } else if (!manualSend) {
                  event.preventDefault();
                  void submit();
                }
              }
            }}
          />
        </div>
        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
            {/* Custom Mode Selector */}
            <ComposerDropdown
              value={mode}
              onChange={(next) =>
                changeMode(z.enum(["build", "plan"]).parse(next))
              }
              options={[
                { value: "build", label: "Build", sub: "执行与修改" },
                { value: "plan", label: "Plan", sub: "只读规划" },
              ]}
              icon={<Lightning size={12} weight="fill" />}
              ariaLabel="运行模式"
            />
            {/* Hidden native select for Playwright test compatibility */}
            <select
              id="run-mode"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              value={mode}
              onChange={(event) =>
                changeMode(z.enum(["build", "plan"]).parse(event.target.value))
              }
            >
              <option value="build">Build</option>
              <option value="plan">Plan</option>
            </select>

            {/* Custom Permission Selector */}
            <ComposerDropdown
              value={
                !running && mode === "plan" ? "readonly" : displayedPermission
              }
              disabled={
                (!running && mode === "plan") ||
                changingPermission ||
                busy ||
                !!submission
              }
              onChange={(next) => void changePermission(next)}
              options={[
                {
                  value: "workspace",
                  label: "工作区",
                  sub: "修改文件需批准命令",
                },
                {
                  value: "readonly",
                  label: "只读",
                  sub: "不修改文件或执行命令",
                },
                {
                  value: "unrestricted",
                  label: "无限制",
                  sub: running
                    ? "立即生效，并放行当前会话待审批操作"
                    : "允许执行系统命令",
                },
              ]}
              icon={<ShieldCheck size={12} />}
              ariaLabel="执行权限"
            />
            {/* Hidden native select for Playwright test compatibility */}
            <select
              id="run-permission"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              value={
                !running && mode === "plan" ? "readonly" : displayedPermission
              }
              disabled={
                (!running && mode === "plan") ||
                changingPermission ||
                busy ||
                !!submission
              }
              onChange={(event) => void changePermission(event.target.value)}
            >
              <option value="workspace">工作区</option>
              <option value="readonly">只读</option>
              <option value="unrestricted">无限制</option>
            </select>
          </div>
          <div className="composer-toolbar-end">
            <UsagePopover
              snapshot={
                !isNew && state.activeSnapshot?.id === state.activeSessionId
                  ? state.activeSnapshot
                  : undefined
              }
              events={
                !isNew && state.activeSnapshot?.id === state.activeSessionId
                  ? state.activeSnapshot.events
                  : []
              }
            />
            <ModelPicker
              value={model}
              models={[state.settings?.model ?? "", ...availableModels]}
              onSelect={setModel}
              onRefresh={() => void listModels()}
              loading={listing}
              error={modelError}
            />
            <div
              className="composer-effort"
              title="思考等级：全局保存，用于后续请求；支持的等级取决于模型服务"
            >
              <ComposerDropdown
                value={state.settings?.reasoningEffort ?? "default"}
                onChange={(value) => void changeEffort(value)}
                disabled={savingEffort || busy || !!submission}
                ariaLabel="思考等级"
                icon={<Brain size={12} aria-hidden="true" />}
                options={[
                  {
                    value: "default",
                    label: "默认",
                    sub: "由模型决定 · 全局保存",
                  },
                  { value: "none", label: "关闭", sub: "none" },
                  { value: "minimal", label: "极低", sub: "minimal" },
                  { value: "low", label: "低", sub: "low" },
                  { value: "medium", label: "中", sub: "medium" },
                  { value: "high", label: "高", sub: "high" },
                  { value: "xhigh", label: "极高", sub: "xhigh" },
                ]}
              />
            </div>
            {running ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="composer-cancel composer-action"
                loading={Boolean(run?.isCancelling)}
                aria-label={run?.isCancelling ? "正在取消" : "取消"}
                title={run?.isCancelling ? "正在取消…" : "停止生成"}
                icon={<Stop size={14} weight="fill" aria-hidden="true" />}
                onClick={() => void cancelRun()}
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="composer-submit composer-run composer-action"
                loading={busy || !!submission}
                disabled={
                  !isConfigured ||
                  !prompt.trim() ||
                  !!submission ||
                  savingEffort
                }
                aria-label={isNew ? "发送并开始会话" : "运行"}
                title={
                  busy || submission
                    ? "正在发送…"
                    : manualSend
                      ? "发送消息"
                      : "发送 · Enter"
                }
                icon={<ArrowUp size={16} weight="bold" aria-hidden="true" />}
              />
            )}
          </div>
        </div>
        {(!isConfigured || mode === "plan" || error) && (
          <div className="composer-status" aria-live="polite">
            {!isConfigured && (
              <span className="wb-muted">
                {configurationHint}{" "}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openSettings(true)}
                >
                  配置模型
                </Button>
              </span>
            )}
            {mode === "plan" && (
              <span className="wb-muted composer-plan-note">
                规划模式只读，不执行修改或 MCP 操作。
              </span>
            )}
            {error && (
              <span role="alert" className="form-error composer-error">
                {error}
              </span>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
