import {
  ArrowUp,
  CaretDown,
  Compass,
  FolderOpen,
  Images,
  Lightning,
  Lock,
  ShieldCheck,
  ShieldWarning,
  Stop,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { permissionSchema, settingsFields } from "../../../shared/schemas";
import type { SessionId } from "../../shared-types";
import {
  type ImageAttachment,
  imageAttachmentsSchema,
} from "../../../shared/images";
import { parseDrafts } from "../../state/drafts";
import { modelCatalogCache } from "../../state/model-catalog-cache";
import { useWorkbench } from "../../state/workbench-context";
import { hostCapabilities } from "../../web-host";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { ComposerDropdown } from "./ComposerDropdown";
import { ModelPicker } from "./ModelPicker";
import { UsagePopover } from "./UsagePopover";
import { OutputSpeed } from "./OutputSpeed";
import {
  ImageAttachments,
  useImageAttachments,
} from "./ImageAttachments";
import { useAutosizePrompt } from "./useAutosizePrompt";
import { useSlashCommands } from "./useSlashCommands";
import "./composer-activity.css";
import "./composer-layout.css";
import "./composer-live-input.css";

const taskSchema = z
  .object({
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
    prompt: z.string().max(1000000),
    images: imageAttachmentsSchema.optional(),
  })
  .refine(
    (data) => Boolean(data.prompt.trim() || (data.images && data.images.length > 0)),
    {
      message: "请输入内容或添加图片",
      path: ["prompt"],
    },
  );
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
    sendSteering,
    queueInput,
    pendingInputs = [],
    inputQueuePaused = false,
    resumeInputs,
    clearInputs,
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
  const {
    images,
    reading,
    error: imageError,
    addFiles,
    removeImage,
    clearImages,
  } = useImageAttachments(draftId);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [sourcesByDraft, setSourcesByDraft] = useState<Record<string, string>>({});
  const providerSourceId = sourcesByDraft[draftId] ?? (!isNew ? state.activeSnapshot?.providerSourceId : undefined) ?? state.settings?.activeSourceId;
  const providerSource = state.settings?.providerSources?.find(source => source.id === providerSourceId);
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
  const modelSource = JSON.stringify([
    providerSourceId ?? "legacy",
    providerSource?.baseUrl ?? state.settings?.baseUrl ?? "",
    providerSource?.apiMode ?? state.settings?.apiMode ?? "chat-completions",
    state.settings?.environmentOverride ?? false,
  ]);
  const currentModelSource = useRef(modelSource);
  currentModelSource.current = modelSource;
  useEffect(() => {
    setAvailableModels(modelCatalogCache.read(modelSource) ?? []);
    setModelError("");
    void listModels();
  }, [modelSource]);
  const allKnownModels = useMemo(() => {
    const list = !isNew && state.activeSnapshot?.providerSourceId ? [model, providerSource?.model, ...availableModels] : [
      model,
      state.settings?.model,
      ...(state.settings?.providerSources?.map((s) => s.model) ?? []),
      ...Object.keys(state.settings?.modelContextWindows ?? {}),
      "cbcn/deepseek-v4.1-flash",
      ...availableModels,
    ];
    return Array.from(
      new Set(
        list
          .filter(
            (m): m is string => typeof m === "string" && m.trim().length > 0,
          )
          .map((m) => m.trim()),
      ),
    );
  }, [
    model,
    state.settings?.model,
    state.settings?.providerSources,
    state.settings?.modelContextWindows,
    availableModels,
    isNew,
    state.activeSnapshot?.providerSourceId,
    providerSource?.model,
  ]);
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
    images?: readonly ImageAttachment[];
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
    if (submission.images && submission.images.length > 0) {
      clearImages(submission.images, submission.draftId);
    }
    setSubmission(null);
    if (submission.draftId === "new") pendingNew.current = null;
    // Do not steal navigation if the user opened a different session while starting.
    if (submission.draftId === "new" && selectedDraft.current === "new")
      void selectSession(submission.id);
  }, [submission, state.activeRuns, selectSession, clearImages]);
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
  const [activityVisible, setActivityVisible] = useState(Boolean(running));
  const [activityClosing, setActivityClosing] = useState(false);
  const lastActiveRun = useRef(run);
  if (running) {
    lastActiveRun.current = run;
  }

  useEffect(() => {
    if (running) {
      setActivityVisible(true);
      setActivityClosing(false);
    } else if (activityVisible) {
      setActivityClosing(true);
      const timer = setTimeout(() => {
        setActivityVisible(false);
        setActivityClosing(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [running]);

  const displayRun = running ? run : lastActiveRun.current;
  const showActivity = activityVisible || running;
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
  const isConfigured = !isNew && state.activeSnapshot?.providerSourceId
    ? Boolean(providerSource?.baseUrl && model) : state.settings?.isConfigured === true;
  const configurationHint = "连接模型后即可开始对话。";
  const { dispatch, loadSessions } = useWorkbench();
  const slash = useSlashCommands({
    prompt,
    draftId,
    input: promptRef,
    busy: busy || !!submission || savingEffort || reading,
    setPrompt: (value) => {
      setDrafts((old) => ({ ...old, [draftId]: value }));
      setManualDrafts((old) => ({ ...old, [draftId]: false }));
    },
    host: {
      bridge: window.forge,
      sessionId: isNew ? undefined : (state.activeSessionId ?? undefined),
      workspace: isNew ? workspace : (state.activeSnapshot?.workspace ?? ""),
      model,
      mode,
      permission,
      running,
      steer: async (text) => {
        const id = state.activeSessionId;
        return id ? sendSteering(text, id) : false;
      },
      queueCommand: (value) => {
        if (value === "clear") clearInputs();
        else if (value === "run") resumeInputs();
        else if (/^add(?:\s|$)/.test(value)) {
          const text = value.slice(3).trim();
          const id = state.activeSessionId;
          if (!running || !id || !text) throw new Error("需要会话处于运行状态且提供非空消息：/queue add <消息>");
          const ok = queueInput({
            sessionId: id,
            prompt: text,
            model,
            permission: mode === "plan" ? "readonly" : permission,
            mode,
            ...(providerSourceId ? { providerSourceId } : {}),
          });
          if (!ok) throw new Error("加入待发队列失败。");
          return "已加入待发队列。";
        }
        else if (value) throw new Error("用法：/queue [add <消息>|clear|run]");
        return `待发 ${pendingInputs.length} 条${inputQueuePaused ? "（已暂停）" : ""}。可用 /queue add <消息> 排队。`;
      },
      setModel,
      setMode: changeMode,
      setPermission: changePermission,
      setReasoning: (value) =>
        updateSettings({
          settings: {
            reasoningEffort: settingsFields.reasoningEffort
              .unwrap()
              .parse(value),
          },
        }),
      openModel: () => {
        const trigger = promptRef.current
          ?.closest("form")
          ?.querySelector<HTMLElement>(".composer-model-picker > summary");
        trigger?.focus();
        trigger?.click();
      },
      applySnapshot: async (snapshot, switchSession) => {
        // The operation targeted the captured session, not whichever session is now selected.
        if (alive.current && selectedDraft.current === draftId) {
          setDrafts((old) =>
            old[draftId] === prompt ? { ...old, [draftId]: "" } : old,
          );
          if (switchSession)
            setModelsByDraft((old) => ({
              ...old,
              [snapshot.id]: snapshot.model,
            }));
          dispatch({ type: "SELECT_SESSION", sessionId: snapshot.id });
          dispatch({ type: "SET_ACTIVE_SNAPSHOT", snapshot });
        }
        await loadSessions();
      },
    },
  });
  const submit = async (kind: "follow-up" | "steer" = "follow-up") => {
    if (slash.isCommand) {
      if (images.length > 0) {
        setError("图片请直接发送；运行中 Enter 排队，Alt+Enter 插话。");
        return;
      }
      await slash.execute();
      return;
    }
    if (
      submitting.current ||
      effortSaving.current ||
      submission ||
      slash.executing ||
      reading
    )
      return;
    if (running && state.activeSessionId && (prompt.trim() || images.length > 0)) {
      const id = state.activeSessionId;
      const capturedDraftId = draftId;
      const capturedPrompt = prompt;
      const capturedImages = images;
      submitting.current = true;
      setBusy(true);
      setError("");
      const accepted = kind === "follow-up"
        ? queueInput({ sessionId: id, prompt: capturedPrompt, model, permission: mode === "plan" ? "readonly" : permission, mode,
          ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
          ...(providerSourceId ? { providerSourceId } : {}) })
        : await sendSteering(capturedPrompt, id, capturedImages.length > 0 ? capturedImages : undefined);
      submitting.current = false;
      if (!alive.current) return;
      setBusy(false);
      if (accepted) {
        setDrafts(old => old[capturedDraftId] === capturedPrompt ? { ...old, [capturedDraftId]: "" } : old);
        setManualDrafts(old => ({ ...old, [capturedDraftId]: false }));
        if (capturedImages.length > 0) {
          clearImages(capturedImages, capturedDraftId);
        }
      } else if (selectedDraft.current === capturedDraftId) setError("消息未确认写入，草稿已保留。请核对会话后手动发送。");
      return;
    }
    if (!isConfigured) {
      setError(configurationHint);
      return;
    }
    const capturedDraftId = draftId;
    const capturedImages = images;
    const parsed = taskSchema.safeParse({
      workspace: isNew ? workspace : state.activeSnapshot?.workspace,
      model,
      prompt,
      ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
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
          { workspace: parsed.data.workspace, model: parsed.data.model, ...(providerSourceId ? { providerSourceId } : {}) },
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
          providerSourceId,
          capturedImages.length > 0 ? capturedImages : undefined,
        )
      : false;
    submitting.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (ok && id) {
      setSubmission({
        id,
        draftId: capturedDraftId,
        prompt,
        ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
      });
    } else if (selectedDraft.current === capturedDraftId)
      setError("未能开始对话，草稿已保留。请检查错误详情后重试。");
  };
  const listModels = async (refresh = false) => {
    if (listing) return;
    const cached = modelCatalogCache.read(modelSource);
    if (cached && !refresh) {
      setAvailableModels(cached);
      setModelError("");
      return;
    }
    setListing(true);
    setModelError("");
    try {
      const models = await modelCatalogCache.load(
        modelSource,
        () => window.forge.listModels(providerSourceId),
        refresh,
      );
      if (alive.current && currentModelSource.current === modelSource)
        setAvailableModels(models);
    } catch (err) {
      if (alive.current)
        setModelError(err instanceof Error ? err.message : "模型列表读取失败");
    } finally {
      if (alive.current) setListing(false);
    }
  };
  const queuedSummary = (() => {
    const first = pendingInputs[0];
    if (!first) return "";
    const trimmed = first.prompt.trim();
    if (trimmed) return trimmed.slice(0, 80);
    if (first.images && first.images.length > 0) {
      return `图片 ${first.images.length} 张`;
    }
    return "";
  })();
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
        <div
          className={`composer-activity-slot${showActivity ? " is-visible" : ""}${
            running && !activityClosing ? " is-entering" : ""
          }${activityClosing ? " is-leaving" : ""}`}
        >
          {showActivity && (
            <output
              className={`composer-activity${displayRun?.status === "running" && !displayRun.isCancelling ? " is-executing" : ""}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="composer-activity-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>
                {displayRun?.isCancelling
                  ? "正在停止"
                  : displayRun?.status === "awaiting_approval"
                    ? "等待审批"
                    : displayRun?.providerRetry
                      ? `重试 ${displayRun.providerRetry}/5`
                    : "正在执行"}
              </span>
              <OutputSpeed run={displayRun} />
            </output>
          )}
          {showActivity && (
            <div className="composer-live-hints" aria-label="快捷键提示">
              <span className="composer-live-hint">Enter 排队</span>
              <span className="composer-live-hint">Alt+Enter 插话</span>
            </div>
          )}
        </div>
        {pendingInputs.length > 0 && (
          <output className="composer-status composer-queue">
            <span className="composer-queue-text">
              待发 {pendingInputs.length} 条{inputQueuePaused ? " · 已暂停" : " · 本轮完成后发送"}：{queuedSummary}
            </span>
            <span className="composer-queue-hint">
              <span>/queue run 继续</span>
              <span>·</span>
              <span>/queue clear 清空</span>
            </span>
          </output>
        )}
        {(!isConfigured || mode === "plan" || error || imageError) && (
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
            {imageError && (
              <span role="alert" className="form-error composer-error">
                {imageError}
              </span>
            )}
          </div>
        )}
        <ImageAttachments
          images={images}
          reading={reading}
          onRemove={removeImage}
        />
        {images.length === 0 && slash.view}
        {/* One integrated composer card: the prompt row and the control row are
            two bands of a single rounded surface, so the text field, the send
            button and the mode/model controls share one silhouette instead of
            reading as three detached strips. The usage meter stays directly
            beneath the card, inset to the card's text edge. */}
        <div className="composer-card composer-surface">
          <div className="composer-input-row">
            <div className="composer-prompt">
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
                ? "描述任务或提问…"
                : "继续对话，或输入新要求…"
            }
            title={
              manualSend
                ? "多行模式：Enter 换行，点击发送"
                : "Enter 发送，Shift+Enter 换行"
            }
            onChange={(event) => {
              setDrafts((old) => ({ ...old, [draftId]: event.target.value }));
            }}
            onPaste={(event) => {
              const clipboardData = event.clipboardData;
              if (!clipboardData) return;
              const items = Array.from(clipboardData.items ?? []);
              const imageFiles: File[] = [];
              for (const item of items) {
                if (item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) imageFiles.push(file);
                }
              }
              if (imageFiles.length === 0) return;
              const hasText = Boolean(clipboardData.getData("text/plain"));
              if (!hasText) {
                event.preventDefault();
              }
              void addFiles(imageFiles);
            }}
            {...slash.inputProps}
            onKeyDown={(event) => {
              if (images.length === 0 && slash.onKeyDown(event)) return;
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
                if (reading) {
                  event.preventDefault();
                  return;
                }
                if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                  event.preventDefault();
                  if (running) {
                    void submit("steer");
                  }
                  return;
                }
                if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
                  event.preventDefault();
                  void submit("follow-up");
                  return;
                }
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
          <div className="composer-submit-col">
            {running ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="composer-cancel composer-action"
                loading={Boolean(run?.isCancelling)}
                aria-label={run?.isCancelling ? "正在取消" : "取消"}
                title={run?.isCancelling ? "正在取消…" : "停止生成"}
                icon={<Stop size={16} weight="fill" aria-hidden="true" />}
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
                  (!isConfigured && !slash.isCommand) ||
                  (!prompt.trim() && images.length === 0) ||
                  reading ||
                  !!submission ||
                  savingEffort
                }
                aria-label={isNew ? "发送并开始会话" : "运行"}
                title={
                  busy || submission
                    ? "正在发送…"
                    : reading
                      ? "正在读取图片…"
                    : manualSend
                      ? "发送消息"
                      : "发送 · Enter"
                }
                icon={<ArrowUp size={16} weight="bold" aria-hidden="true" />}
              />
            )}
          </div>
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
              iconOnly={true}
              icon={
                mode === "plan" ? (
                  <Compass size={16} weight="fill" />
                ) : (
                  <Lightning size={16} weight="fill" />
                )
              }
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
              value={mode === "plan" ? "readonly" : displayedPermission}
              disabled={
                mode === "plan" || changingPermission || busy || !!submission || reading
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
              iconOnly={true}
              icon={
                (mode === "plan" ? "readonly" : displayedPermission) === "readonly" ? (
                  <Lock size={16} />
                ) : (mode === "plan" ? "readonly" : displayedPermission) === "unrestricted" ? (
                  <ShieldWarning size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )
              }
              ariaLabel="执行权限"
            />
            {/* Hidden native select for Playwright test compatibility */}
            <select
              id="run-permission"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              value={mode === "plan" ? "readonly" : displayedPermission}
              disabled={
                mode === "plan" || changingPermission || busy || !!submission || reading
              }
              onChange={(event) => void changePermission(event.target.value)}
            >
              <option value="workspace">工作区</option>
              <option value="readonly">只读</option>
              <option value="unrestricted">无限制</option>
            </select>
            <button
              type="button"
              className="composer-dropdown-trigger is-icon-only composer-image-trigger"
              onClick={() => fileInputRef.current?.click()}
              disabled={reading}
              aria-label="添加图片"
              title="添加图片"
            >
              <Images size={16} aria-hidden="true" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label="选择图片文件"
              className="visually-hidden"
              tabIndex={-1}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) {
                  void addFiles(files);
                }
              }}
            />
          </div>
          <div className="composer-toolbar-end">
            <ModelPicker
              value={model}
              models={allKnownModels}
              hideSearch={true}
              onSelect={setModel}
              onOpen={() => void listModels()}
              onRefresh={() => void listModels(true)}
              loading={listing}
              error={modelError}
              reasoning={{
                value: state.settings?.reasoningEffort ?? "default",
                disabled: savingEffort || busy || !!submission,
                onChange: (value) => void changeEffort(value),
              }}
              sourceControl={
                providerSourceId ? (
                  <ComposerDropdown
                    ariaLabel="会话模型来源"
                    value={providerSourceId}
                    disabled={busy || !!submission}
                    options={[
                      ...(!providerSource ? [{ value: providerSourceId, label: `${providerSourceId}（不可用）` }] : []),
                      ...(state.settings?.providerSources?.map((source) => ({
                        value: source.id,
                        label: source.label,
                        sub: "后续运行使用此来源",
                      })) ?? []),
                    ]}
                    onChange={(value) => {
                      setSourcesByDraft((old) => ({ ...old, [draftId]: value }));
                      const selected = state.settings?.providerSources?.find((source) => source.id === value);
                      if (selected) setModel(selected.model);
                    }}
                  />
                ) : undefined
              }
            />
          </div>
        </div>
        </div>
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
      </div>
    </form>
  );
}
