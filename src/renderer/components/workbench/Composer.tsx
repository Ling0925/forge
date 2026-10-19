import {
  ArrowUp,
  Compass,
  Images,
  Lightning,
  Lock,
  ShieldCheck,
  ShieldWarning,
  Stop,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { permissionSchema, settingsFields } from "../../../shared/schemas";
import type { SessionId } from "../../shared-types";
import {
  type ImageAttachment,
  imageAttachmentsSchema,
} from "../../../shared/images";
import { parseDrafts } from "../../state/drafts";
import { modelCatalogCache, modelCatalogKey } from "../../state/model-catalog-cache";
import { useWorkbench } from "../../state/workbench-context";
import { hostCapabilities } from "../../web-host";
import { Button } from "../primitives/Button";
import { WorkspacePicker } from "./WorkspacePicker";
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
  const promptRef = useRef<HTMLTextAreaElement>(null);
  useAutosizePrompt(promptRef, prompt);
  const [longPressing, setLongPressing] = useState(false);
  const [steerReady, setSteerReady] = useState(false);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<number>(0);
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (/[\r\n]/.test(prompt))
      setManualDrafts((old) =>
        old[draftId] ? old : { ...old, [draftId]: true },
      );
  }, [draftId, prompt]);
  const workspaceRestricted = hostCapabilities.web && window.forge?.restrictWorkspace !== false;
  const defaultWorkspace =
    state.activeSnapshot?.workspace ?? state.sessions[0]?.workspace ?? "";
  useEffect(() => {
    if (!isNew) return;
    if (hostCapabilities.web && (workspaceRestricted || !defaultWorkspace)) {
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
  }, [isNew, defaultWorkspace, workspaceRestricted]);
  useEffect(() => {
    if (isNew && !state.isSettingsOpen) promptRef.current?.focus();
  }, [isNew, state.isSettingsOpen]);
  const [picks, setPicks] = useState<
    Record<string, Readonly<{ sourceId?: string | undefined; model: string }>>
  >({});
  const sourceProfiles = state.settings?.providerSources ?? [];
  const pick = picks[draftId];
  const providerSourceId =
    pick?.sourceId ??
    (!isNew ? state.activeSnapshot?.providerSourceId : undefined) ??
    state.settings?.activeSourceId;
  const providerSource = sourceProfiles.find((source) => source.id === providerSourceId);
  // A model only belongs to the source it was picked under. Keeping them in one
  // record prevents "source B + model of A" from ever being submitted.
  const pinnedModel =
    pick && (pick.sourceId === undefined || pick.sourceId === providerSourceId)
      ? pick.model
      : undefined;
  const defaultModel = !isNew
    ? (state.activeSnapshot?.model ?? providerSource?.model)
    : providerSource?.model;
  const model = pinnedModel ?? defaultModel ?? state.settings?.model ?? "";
  const setModel = (value: string) =>
    setPicks((old) => ({ ...old, [draftId]: { sourceId: providerSourceId, model: value } }));
  const [catalogs, setCatalogs] = useState<Record<string, readonly string[]>>({});
  const [modelError, setModelError] = useState("");
  const [listing, setListing] = useState(false);
  const modelSource = modelCatalogKey({
    id: providerSourceId,
    baseUrl: providerSource?.baseUrl ?? state.settings?.baseUrl ?? "",
    apiMode: providerSource?.apiMode ?? state.settings?.apiMode,
  }, state.settings?.environmentOverride ?? false);
  const catalogSources = sourceProfiles.length
    ? sourceProfiles.map((source) => ({ id: source.id, label: source.label, key: modelCatalogKey(source) }))
    : [{ id: undefined, label: "当前来源", key: modelSource }];
  const catalogSignature = JSON.stringify(catalogSources);
  useEffect(() => {
    void listModels();
  }, [catalogSignature]);
  const allKnownModels = [
    ...new Set(
      [
        model,
        ...(catalogs[modelSource] ?? modelCatalogCache.read(modelSource) ?? []),
      ].filter(Boolean),
    ),
  ];
  // Custom IDs stay allowed, but flag one this source never advertised.
  const sourceCatalog = providerSource
    ? (catalogs[modelCatalogKey(providerSource)] ??
      modelCatalogCache.read(modelCatalogKey(providerSource)) ??
      [])
    : [];
  const modelUnlisted =
    Boolean(model && providerSource) &&
    sourceCatalog.length > 0 &&
    !sourceCatalog.includes(model) &&
    model !== providerSource?.model;
  const modelGroups = sourceProfiles.length ? [
    ...sourceProfiles.map((source) => ({
      sourceId: source.id,
      label: source.label,
      models: [...new Set([
        ...(source.id === providerSourceId && model ? [model] : []),
        source.model,
        ...(catalogs[modelCatalogKey(source)] ?? modelCatalogCache.read(modelCatalogKey(source)) ?? []),
      ].filter(Boolean))],
    })),
    ...(!providerSource && providerSourceId
      ? [{ sourceId: providerSourceId, label: `${providerSourceId}（来源已删除）`, models: model ? [model] : [] }]
      : []),
  ] : undefined;
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
      const result = await updateSettings({ settings: { reasoningEffort } });
      if (!result.ok && alive.current) setError(result.error || "思考等级保存失败，请重试。");
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

  const isDual = running && Boolean(prompt.trim() || images.length > 0);
  const wasDualRef = useRef(false);
  const [rebounding, setRebounding] = useState(false);
  useEffect(() => {
    if (isDual) {
      setRebounding(false);
    } else if (wasDualRef.current && running) {
      setRebounding(true);
      const timer = setTimeout(() => setRebounding(false), 260);
      return () => clearTimeout(timer);
    }
    wasDualRef.current = isDual;
  }, [isDual, running]);

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
  const isConfigured =
    providerSourceId && !providerSource
      ? false
      : providerSource
        ? Boolean(providerSource.baseUrl && model)
        : state.settings?.isConfigured === true;
  const configurationHint = providerSourceId && !providerSource
    ? "当前会话绑定的模型来源已被删除，请在设置中重新选择来源。"
    : providerSource && !providerSource.model
      ? "此来源尚未设置默认模型，请先在设置中选择模型。"
      : "连接模型后即可开始对话。";
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
      setReasoning: async (value) => {
        const result = await updateSettings({
          settings: {
            reasoningEffort: settingsFields.reasoningEffort
              .unwrap()
              .parse(value),
          },
        });
        return result.ok;
      },
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
            setPicks((old) => ({
              ...old,
              [snapshot.id]: {
                ...(snapshot.providerSourceId ? { sourceId: snapshot.providerSourceId } : {}),
                model: snapshot.model,
              },
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
    // The pair is validated together: a model picked under one source must
    // never be submitted with another source's endpoint and credential.
    if (pick && pick.sourceId !== undefined && pick.sourceId !== providerSourceId) {
      setError("所选模型属于其他来源，请重新选择模型。");
      return;
    }
    if (providerSource && !providerSource.model && !model) {
      setError("请先在设置中为此来源选择默认模型。");
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
  const handleSendPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    setLongPressing(true);
    setSteerReady(false);
    pressStartRef.current = Date.now();
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      setSteerReady(true);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        try { navigator.vibrate(30); } catch {}
      }
    }, 500);
  };
  const handleSendPointerUp = () => {
    if (!longPressing && !pressStartRef.current) return;
    const isSteer = steerReady || (Date.now() - pressStartRef.current >= 500);
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setLongPressing(false);
    setSteerReady(false);
    pressStartRef.current = 0;
    if (isSteer) {
      void submit("steer");
    } else {
      void submit("follow-up");
    }
  };
  const handleSendPointerCancel = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    setLongPressing(false);
    setSteerReady(false);
    pressStartRef.current = 0;
  };
  const handleSendClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (pressStartRef.current === 0 && !longPressing) {
      void submit("follow-up");
    }
  };
  const listModels = async (refresh = false) => {
    setListing(true);
    setModelError("");
    const results = await Promise.allSettled(catalogSources.map(async (source) => {
      const models = await modelCatalogCache.load(source.key, () => window.forge.listModels(source.id), refresh);
      if (alive.current) setCatalogs((old) => ({ ...old, [source.key]: models }));
    }));
    if (!alive.current) return;
    const errors = results.flatMap((result, index) => result.status === "rejected"
      ? [`${catalogSources[index]?.label}: ${result.reason instanceof Error ? result.reason.message : "模型列表读取失败"}`] : []);
    // A failed read must not leave stale models selectable under a source.
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const key = catalogSources[index]?.key;
        if (key) setCatalogs((old) => ({ ...old, [key]: [] }));
      }
    });
    setModelError(errors.join("；"));
    setListing(false);
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
        <WorkspacePicker
          workspace={workspace}
          chooseWorkspace={chooseWorkspace}
          onChange={setWorkspace}
          onDone={() => promptRef.current?.focus()}
        />
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
              {!isNew && state.activeSnapshot?.id === state.activeSessionId && (
                <OutputSpeed run={displayRun} events={state.activeSnapshot.events} />
              )}
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
        {(!isConfigured || mode === "plan" || error || imageError || modelUnlisted) && (
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
            {modelUnlisted && (
              <span className="wb-muted composer-plan-note">
                当前模型 {model} 不在来源 {providerSource?.label} 的目录中，调用可能失败。
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
          <div
            className={`composer-submit-col ${
              isDual ? "is-dual" : ""
            } ${rebounding ? "is-rebounding" : ""}`}
          >
            {running ? (
              <>
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
                {Boolean(prompt.trim() || images.length > 0) && (
                  <div className="composer-dual-send-wrap">
                    {longPressing && (
                      <div
                        className={`composer-longpress-tip ${
                          steerReady ? "is-steer" : ""
                        }`}
                        role="status"
                      >
                        {steerReady ? "松开立即插话 ⚡" : "长按插话…"}
                      </div>
                    )}
                    <button
                      type="button"
                      className={`btn btn-primary btn-sm composer-submit composer-action composer-btn-steer-hold ${
                        longPressing ? "is-pressing" : ""
                      } ${steerReady ? "is-steer-ready" : ""}`}
                      disabled={busy || !!submission || reading || savingEffort}
                      aria-label={steerReady ? "插话" : "发送"}
                      title="点击排队发送，长按插话"
                      onContextMenu={(e) => e.preventDefault()}
                      onPointerDown={handleSendPointerDown}
                      onPointerUp={handleSendPointerUp}
                      onPointerLeave={handleSendPointerCancel}
                      onPointerCancel={handleSendPointerCancel}
                      onClick={handleSendClick}
                    >
                      {longPressing && (
                        <svg
                          className={`composer-longpress-ring ${
                            steerReady ? "is-ready" : ""
                          }`}
                          viewBox="0 0 44 44"
                          aria-hidden="true"
                        >
                          <circle
                            cx="22"
                            cy="22"
                            r="18"
                            className="composer-ring-track"
                          />
                          <circle
                            cx="22"
                            cy="22"
                            r="18"
                            className={`composer-ring-indicator ${
                              steerReady ? "is-ready" : ""
                            }`}
                          />
                        </svg>
                      )}
                      {steerReady ? (
                        <Lightning size={16} weight="fill" aria-hidden="true" />
                      ) : (
                        <ArrowUp size={16} weight="bold" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </>
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
              sourceLabel={providerSource?.label}
              onSelect={(model, sourceId) => {
                if (busy || submission) return;
                // Picking a model records the source it came from in the same
                // update, so the pair can never drift apart.
                setPicks((old) => ({
                  ...old,
                  [draftId]: {
                    ...(sourceId ? { sourceId } : providerSourceId ? { sourceId: providerSourceId } : {}),
                    model,
                  },
                }));
              }}
              onOpen={() => void listModels()}
              onRefresh={() => void listModels(true)}
              loading={listing}
              error={modelError}
              reasoning={{
                value: state.settings?.reasoningEffort ?? "default",
                disabled: savingEffort || busy || !!submission,
                onChange: (value) => void changeEffort(value),
              }}
              groups={modelGroups}
              sourceId={providerSourceId}
              disabled={busy || !!submission}
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
