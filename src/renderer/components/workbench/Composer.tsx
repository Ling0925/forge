import { ArrowUp, CaretDown, Stop } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { permissionSchema, settingsFields } from "../../../shared/schemas";
import { parseDrafts } from "../../state/drafts";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import { Dialog } from "./Dialog";
import { permissionLabels } from "./Settings";

const taskSchema = z.object({
  workspace: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine(
      (s) =>
        s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\"),
      "请输入绝对工作区路径",
    ),
  model: settingsFields.model,
  prompt: z.string().trim().min(1).max(1000000),
});
const shortPermission = {
  readonly: "只读",
  workspace: "工作区",
  unrestricted: "无限制",
} as const;

/** Last segment of a real model id. Display only; the stored value is unchanged. */
function shortModelName(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "未选择模型";
  const leaf = trimmed.split("/").filter(Boolean).at(-1) ?? trimmed;
  return leaf.length > 28 ? `${leaf.slice(0, 27)}…` : leaf;
}

export function Composer({ isNew = false }: { readonly isNew?: boolean }) {
  const {
    state,
    startRun,
    createSession,
    chooseWorkspace,
    cancelRun,
    openNewSession,
  } = useWorkbench();
  const storageKey = isNew ? "forge-new-task-draft" : "forge-composer-drafts";
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>(() => {
    try {
      return parseDrafts(sessionStorage.getItem(storageKey));
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(drafts));
    } catch {
      /* draft remains available in memory */
    }
  }, [drafts, storageKey]);
  const draftId = isNew ? "new" : (state.activeSessionId ?? "none");
  const prompt = drafts[draftId] ?? "";
  const selectedDraft = useRef(draftId);
  selectedDraft.current = draftId;
  const [workspace, setWorkspace] = useState(
    state.activeSnapshot?.workspace ?? "",
  );
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
  const [permission, setPermission] = useState(
    state.settings?.defaultPermission ?? "workspace",
  );
  const permissionTouched = useRef(false);
  useEffect(() => {
    if (!permissionTouched.current && state.settings)
      setPermission(state.settings.defaultPermission);
  }, [state.settings]);
  const [submission, setSubmission] = useState<{
    id: string;
    draftId: string;
    prompt: string;
  } | null>(null);
  useEffect(() => {
    if (submission && state.activeRuns[submission.id]?.accepted) {
      setDrafts((old) =>
        old[submission.draftId] === submission.prompt
          ? { ...old, [submission.draftId]: "" }
          : old,
      );
      setSubmission(null);
      if (isNew) openNewSession(false);
    }
  }, [submission, state.activeRuns, isNew, openNewSession]);
  const [mode, setMode] = useState<"build" | "plan">("build");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRequested, setConfirmRequested] = useState(false);
  const [unrestrictedConsent, setUnrestrictedConsent] = useState(false);
  const revokeUnrestrictedConsent = () => {
    setUnrestrictedConsent(false);
    setConfirmRequested(false);
  };
  useEffect(() => {
    if (!draftId) return;
    setError("");
    setBusy(false);
    setUnrestrictedConsent(false);
    setConfirmRequested(false);
  }, [draftId]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = state.activeSessionId
    ? state.activeRuns[state.activeSessionId]
    : undefined;
  const running =
    !isNew &&
    (run?.status === "running" || run?.status === "awaiting_approval");
  const isConfigured = state.settings?.isConfigured === true;
  const configurationHint = "请先在设置中配置 API，再创建或运行任务。";
  const submit = async () => {
    if (busy || running) return;
    if (!isConfigured) {
      setError(configurationHint);
      return;
    }
    if (
      permission === "unrestricted" &&
      mode !== "plan" &&
      !unrestrictedConsent
    ) {
      setConfirmRequested(true);
      setError("无限制权限需要先确认。");
      return;
    }
    const parsed = taskSchema.safeParse({
      workspace: isNew ? workspace : state.activeSnapshot?.workspace,
      model,
      prompt,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("；"));
      return;
    }
    setBusy(true);
    setError("");
    let id = state.activeSessionId;
    if (isNew) {
      const snapshot = await createSession({
        workspace: parsed.data.workspace,
        model: parsed.data.model,
        title: parsed.data.prompt.slice(0, 80),
      });
      id = snapshot?.id ?? null;
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
    if (!alive.current) return;
    if (selectedDraft.current === draftId) setBusy(false);
    if (ok && id) {
      setSubmission({ id, draftId, prompt });
      revokeUnrestrictedConsent();
    } else if (selectedDraft.current === draftId)
      setError(
        "任务未启动。检查错误详情；若会话被其他进程占用，请等待锁释放后重试。",
      );
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
  const promptId = isNew ? "new-prompt" : `prompt-${draftId}`;
  const modelField = (scope: "composer" | "new") => {
    const modelInputId = scope === "new" ? "new-model" : "run-model";
    const modelListId =
      scope === "new" ? "new-model-options" : "run-model-options";
    const closeModelPicker = () => {
      const details = document.getElementById(modelInputId)?.closest("details");
      if (details instanceof HTMLDetailsElement) details.open = false;
    };
    return (
      <details
        className={`composer-model composer-model-picker${scope === "new" ? " composer-model-inline" : ""}`}
        onToggle={(event) => {
          if (event.currentTarget.open) {
            queueMicrotask(() =>
              document.getElementById(modelInputId)?.focus(),
            );
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.stopPropagation();
          closeModelPicker();
          event.currentTarget.querySelector("summary")?.focus();
        }}
      >
        <summary
          className="composer-model-summary"
          title={model || "尚未选择模型"}
        >
          <span className="composer-model-kicker">模型</span>
          <span className="composer-model-name composer-model-short">
            {shortModelName(model)}
          </span>
          <CaretDown size={12} aria-hidden="true" />
        </summary>
        <div className="composer-model-panel">
          <Field
            id={modelInputId}
            label="精确模型 ID"
            helper="只使用目录中的 ID 或你手动输入的完整 ID，不会猜测提供方。"
            error={modelError || undefined}
          >
            <Input
              id={modelInputId}
              list={modelListId}
              aria-label="模型 ID"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={state.settings?.model || "provider/model"}
            />
            <datalist id={modelListId}>
              {availableModels.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </Field>
          {model ? (
            <p className="composer-model-id composer-model-full" title={model}>
              当前完整 ID：{model}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={listing}
            onClick={() => void listModels()}
          >
            {listing ? "正在读取目录…" : "读取可用模型"}
          </Button>
        </div>
      </details>
    );
  };
  const promptField = (
    <div className={`composer-prompt ${isNew ? "" : "is-quiet"}`}>
      <label
        htmlFor={promptId}
        className={
          isNew
            ? "form-label composer-prompt-label"
            : "visually-hidden composer-prompt-label"
        }
      >
        {isNew ? "新任务描述" : "继续任务"}
      </label>
      <textarea
        id={promptId}
        className="composer-textarea"
        aria-label={isNew ? "新任务描述" : "继续任务"}
        value={prompt}
        rows={isNew ? 5 : 2}
        onChange={(e) => {
          revokeUnrestrictedConsent();
          setDrafts((old) => ({ ...old, [draftId]: e.target.value }));
        }}
        placeholder="描述要完成的工作…"
        onKeyDown={(e) => {
          if (
            (e.ctrlKey || e.metaKey) &&
            e.key === "Enter" &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            void submit();
          }
        }}
      />
    </div>
  );
  if (isNew) {
    return (
      <Dialog
        open={state.isNewSessionOpen}
        title="新建任务"
        kicker="选择工作区与权限后再开始"
        initialFocus="#workspace-path"
        onClose={() => openNewSession(false)}
      >
        <form
          className="new-task-form composer-new"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="modal-content wb-stack composer-inner composer-new-fields">
            <Field id="workspace-path" label="工作区绝对路径">
              <div className="composer-workspace-row composer-workspace">
                <Input
                  id="workspace-path"
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                />
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
              </div>
            </Field>
            <div className="composer-choice-row composer-options composer-new-options">
              <Field id="new-mode" label="模式">
                <Select
                  id="new-mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(z.enum(["build", "plan"]).parse(e.target.value));
                    revokeUnrestrictedConsent();
                  }}
                  options={[
                    { value: "build", label: "Build · 执行与修改" },
                    { value: "plan", label: "Plan · 只读规划" },
                  ]}
                />
              </Field>
              <Field id="new-permission" label="权限">
                <Select
                  id="new-permission"
                  value={permission}
                  disabled={mode === "plan"}
                  onChange={(e) => {
                    permissionTouched.current = true;
                    const next = permissionSchema.parse(e.target.value);
                    setPermission(next);
                    revokeUnrestrictedConsent();
                  }}
                  options={Object.entries(permissionLabels).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </Field>
            </div>
            {mode === "plan" && (
              <p className="wb-muted">规划模式只读，不执行修改或 MCP 操作。</p>
            )}
            {modelField("new")}
            {promptField}
            {confirmRequested && mode !== "plan" && (
              <p className="composer-confirm">
                无限制允许执行命令，且不是操作系统沙箱。确认后才会创建任务。
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setUnrestrictedConsent(true);
                    setConfirmRequested(false);
                    setError("");
                  }}
                >
                  我已理解并确认无限制
                </Button>
              </p>
            )}
            {!isConfigured && <p className="form-error">{configurationHint}</p>}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {busy && (
              <p className="composer-busy" aria-live="polite">
                正在创建任务…
              </p>
            )}
          </div>
          <footer className="modal-footer composer-controls">
            <Button
              type="button"
              variant="ghost"
              onClick={() => openNewSession(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={!isConfigured}
            >
              创建并运行
            </Button>
          </footer>
        </form>
      </Dialog>
    );
  }
  return (
    <form
      className="workbench-composer composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-label="任务输入"
    >
      <div className="composer-inner composer-surface">
        {promptField}
        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
            <div className="composer-pill composer-field composer-mode">
              <label
                className="visually-hidden composer-compact-label"
                htmlFor="run-mode"
              >
                模式
              </label>
              <Select
                id="run-mode"
                className="composer-compact-select"
                aria-label="模式"
                value={mode}
                onChange={(e) => {
                  setMode(z.enum(["build", "plan"]).parse(e.target.value));
                  revokeUnrestrictedConsent();
                }}
                options={[
                  { value: "build", label: "Build" },
                  { value: "plan", label: "Plan" },
                ]}
              />
            </div>
            <div className="composer-pill composer-field composer-permission">
              <label
                className="visually-hidden composer-compact-label"
                htmlFor="run-permission"
              >
                权限
              </label>
              <Select
                id="run-permission"
                className="composer-compact-select"
                aria-label="权限"
                value={permission}
                disabled={mode === "plan"}
                onChange={(e) => {
                  permissionTouched.current = true;
                  const next = permissionSchema.parse(e.target.value);
                  setPermission(next);
                  revokeUnrestrictedConsent();
                }}
                options={Object.entries(shortPermission).map(
                  ([value, label]) => ({
                    value,
                    label:
                      value === "unrestricted" ? `${label} · 需确认` : label,
                  }),
                )}
              />
            </div>
          </div>
          <div className="composer-toolbar-end">
            {modelField("composer")}
            {running ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="composer-cancel"
                loading={Boolean(run?.isCancelling)}
                onClick={() => void cancelRun()}
              >
                <Stop size={14} aria-hidden="true" />
                {run?.isCancelling ? "正在取消…" : "取消"}
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="composer-submit composer-run"
                loading={busy}
                disabled={!isConfigured || !prompt.trim()}
                aria-label="运行"
              >
                <ArrowUp size={16} weight="bold" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        {(!isConfigured ||
          mode === "plan" ||
          busy ||
          error ||
          confirmRequested) && (
          <div className="composer-status" aria-live="polite">
            {!isConfigured && (
              <span className="form-error">{configurationHint}</span>
            )}
            {mode === "plan" && (
              <span className="wb-muted composer-plan-note">
                规划模式只读，不执行修改或 MCP 操作。
              </span>
            )}
            {busy && <span className="composer-busy">正在提交…</span>}
            {error && (
              <span role="alert" className="form-error composer-error">
                {error}
              </span>
            )}
            {confirmRequested && mode !== "plan" && (
              <span className="composer-confirm">
                无限制允许执行命令，且不是操作系统沙箱。
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setUnrestrictedConsent(true);
                    setConfirmRequested(false);
                    setError("");
                  }}
                >
                  我已理解并确认无限制
                </Button>
              </span>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
