import {
  ArrowUp,
  Check,
  Compass,
  DotsSixVertical,
  Images,
  Lightning,
  Lock,
  PencilSimple,
  ShieldCheck,
  ShieldWarning,
  Stop,
  X,
} from "@phosphor-icons/react";
import { type DragEvent as ReactDragEvent, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { permissionSchema, type RunInput, settingsFields } from "../../../shared/schemas";
import type { SessionId } from "../../shared-types";
import {
  type ImageAttachment,
  imageAttachmentsSchema,
} from "../../../shared/images";
import { parseDrafts } from "../../state/drafts";
import type { ModelCatalog } from "../../../shared/model-catalog";
import { modelCatalogCache, modelCatalogKey } from "../../state/model-catalog-cache";
import { composerEffortUpdate, composerModelMetadata, composerReasoningEffort, selectableModelIds } from "../../state/composer-model";
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

type PendingSubmission = {
  readonly id: SessionId;
  readonly draftId: string;
  readonly prompt: string;
  readonly images?: readonly ImageAttachment[];
};

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
    model: settingsFields.model.optional(),
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
    queueItemKey,
    removeQueuedInput,
    updateQueuedInput,
    reorderQueuedInputs,
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
  // The composer stays mounted during navigation; next-run modes belong to drafts, not the view.
  const [modes, setModes] = useState<Readonly<Record<string, "build" | "plan">>>({});
  const mode = modes[draftId] ?? "build";
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
    Record<
      string,
      Readonly<{
        sourceId?: string | undefined;
        model?: string | undefined;
        routeGroupId?: string | undefined;
      }>
    >
  >({});
  const sourceProfiles = state.settings?.providerSources ?? [];
  const routes = state.settings?.routeGroups ?? [];
  const pick = picks[draftId];
  const routeChoice =
    pick?.routeGroupId ??
    (!isNew ? state.activeSnapshot?.routeGroupId : undefined);
  const selectedRoute = routes.find((route) => route.id === routeChoice);
  const providerSourceId = selectedRoute
    ? undefined
    : (pick?.sourceId ??
      (!isNew ? state.activeSnapshot?.providerSourceId : undefined) ??
      state.settings?.activeSourceId);
  const providerSource = sourceProfiles.find((source) => source.id === providerSourceId);
  // A model only belongs to the source it was picked under. Keeping them in one
  // record prevents "source B + model of A" from ever being submitted.
  const pinnedModel =
    !selectedRoute &&
    pick &&
    (pick.sourceId === undefined || pick.sourceId === providerSourceId)
      ? pick.model
      : undefined;
  const defaultModel = selectedRoute
    ? undefined
    : !isNew
      ? (state.activeSnapshot?.model ?? providerSource?.model)
      : providerSource?.model;
  const model =
    pinnedModel ?? defaultModel ?? (selectedRoute ? "" : state.settings?.model) ?? "";
  // `/model <id>` names only a model, so resolve its source the same way the
  // picker does: the model carries its source instead of needing a switch.
  const setModel = (value: string) => {
    const owners = sourceProfiles.filter((source) => source.model === value);
    const sourceId = owners.length === 1 ? owners[0]?.id : providerSourceId;
    setPicks((old) => ({
      ...old,
      [draftId]: { ...(sourceId ? { sourceId } : {}), model: value },
    }));
  };
  const setRoute = (routeGroupId: string) => {
    setPicks((old) => ({
      ...old,
      [draftId]: { routeGroupId },
    }));
  };
  const [catalogs, setCatalogs] = useState<Record<string, ModelCatalog>>({});
  const [modelError, setModelError] = useState("");
  const [listing, setListing] = useState(false);
  const catalogRequest = useRef(0);
  const modelSource = modelCatalogKey(providerSource ?? {
    id: providerSourceId,
    baseUrl: state.settings?.baseUrl ?? "",
    apiMode: state.settings?.apiMode,
  }, state.settings?.environmentOverride ?? false);
  const catalogSources = sourceProfiles.length
    ? sourceProfiles.map((source) => ({ id: source.id, label: source.label, key: modelCatalogKey(source) }))
    : [{ id: undefined, label: "当前来源", key: modelSource }];
  const catalogSignature = JSON.stringify(catalogSources);
  useEffect(() => {
    if (!state.settings) return;
    const liveKeys = catalogSources.map((source) => source.key);
    modelCatalogCache.retain(liveKeys);
    setCatalogs((old) => Object.fromEntries(Object.entries(old).filter(([key]) => liveKeys.includes(key))));
    void listModels();
    return () => { catalogRequest.current++; };
  }, [catalogSignature, !!state.settings]);
  const sourceCatalog = catalogs[modelSource] ?? modelCatalogCache.read(modelSource) ?? [];
  const selectedMetadata = composerModelMetadata(model, providerSource, sourceCatalog);
  // Keep discovery for context/effort metadata, but offer only saved models.
  // A pinned historical/custom ID remains visible as the current selection,
  // never as a newly selectable option merely because it was used before.
  const configuredModels = providerSource
    ? selectableModelIds(providerSource)
    : providerSourceId ? [] : [state.settings?.model ?? ""].filter(Boolean);
  const modelUnlisted = !selectedRoute && !!model && !configuredModels.includes(model);
  const modelGroups = sourceProfiles.length ? sourceProfiles.map((source) => ({
    sourceId: source.id,
    label: source.label,
    models: selectableModelIds(source),
  })).filter((group) => group.models.length > 0) : undefined;
  const [savingEffort, setSavingEffort] = useState(false);
  const effortSaving = useRef(false);
  const changeEffort = async (value: string) => {
    if (effortSaving.current || (providerSourceId && !providerSource)) return;
    const reasoningEffort = settingsFields.reasoningEffort
      .unwrap()
      .parse(value);
    effortSaving.current = true;
    setSavingEffort(true);
    setError("");
    try {
      const result = await updateSettings(composerEffortUpdate(model, providerSource, reasoningEffort));
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
  // The composer stays mounted while sessions change, so submission state is
  // owned by a draft/session rather than by the component instance. One
  // session's pending write must never disable or clear another session.
  const [submissions, setSubmissions] = useState<
    Readonly<Record<string, PendingSubmission>>
  >({});
  const submission = submissions[draftId];
  useEffect(() => {
    const entries = Object.entries(submissions);
    if (entries.length === 0) return;
    const settled = new Set<string>();
    for (const [key, entry] of entries) {
      const submittedRun = state.activeRuns[entry.id];
      if (!submittedRun?.accepted) {
        if (
          !submittedRun ||
          !["running", "awaiting_approval"].includes(submittedRun.status)
        ) {
          settled.add(key);
          if (selectedDraft.current === entry.draftId)
            setError("消息未被接收，草稿已保留。请检查错误详情后重试。");
        }
        continue;
      }
      settled.add(key);
      // Clear only this submission's own draft, and only while it still holds
      // exactly the text that was submitted. A newer edit always survives.
      if (draftsRef.current[entry.draftId] === entry.prompt) {
        setManualDrafts((old) =>
          old[entry.draftId] ? { ...old, [entry.draftId]: false } : old,
        );
        setDrafts((old) =>
          old[entry.draftId] === entry.prompt
            ? { ...old, [entry.draftId]: "" }
            : old,
        );
      }
      if (entry.images && entry.images.length > 0) {
        clearImages(entry.images, entry.draftId);
      }
      if (entry.draftId === "new") {
        pendingNew.current = null;
        // Adopt the new draft's latest choice only after acceptance, then reset the next new draft.
        // A choice made directly in the created session while starting takes precedence.
        setModes(({ new: fresh = "build", ...sessions }) => ({
          ...sessions,
          [entry.id]: sessions[entry.id] ?? fresh,
        }));
        // Do not steal navigation if the user opened a different session while starting.
        if (selectedDraft.current === "new") void selectSession(entry.id);
      }
    }
    if (settled.size === 0) return;
    // Remove only the entries this pass observed. A newer submission for the
    // same draft must never be erased by an older completion.
    setSubmissions((old) => {
      let next: Record<string, PendingSubmission> | null = null;
      for (const [key, entry] of entries) {
        if (!settled.has(key) || old[key] !== entry) continue;
        next ??= { ...old };
        delete next[key];
      }
      return next ?? old;
    });
  }, [submissions, state.activeRuns, selectSession, clearImages]);
  const [busyDrafts, setBusyDrafts] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const busy = busyDrafts.has(draftId);
  const setDraftBusy = (target: string, value: boolean) => {
    setBusyDrafts((old) => {
      if (old.has(target) === value) return old;
      const next = new Set(old);
      if (value) next.add(target);
      else next.delete(target);
      return next;
    });
  };
  const submitting = useRef(new Set<string>());
  const pendingNew = useRef<{
    id: SessionId;
    workspace: string;
    model: string;
    routeGroupId?: string;
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
  const lastActiveRun = useRef({ draftId, run });
  if (running) {
    lastActiveRun.current = { draftId, run };
  }

  useEffect(() => {
    if (running) {
      setActivityVisible(true);
      setActivityClosing(false);
    } else if (lastActiveRun.current.draftId !== draftId) {
      // Switching sessions is not a run finishing; never animate another owner's status.
      setActivityVisible(false);
      setActivityClosing(false);
    } else if (activityVisible) {
      setActivityClosing(true);
      const timer = setTimeout(() => {
        setActivityVisible(false);
        setActivityClosing(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [running, draftId]);

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

  const sameActivityOwner = lastActiveRun.current.draftId === draftId;
  const displayRun = running ? run : sameActivityOwner ? lastActiveRun.current.run : undefined;
  const showActivity = running || (sameActivityOwner && activityVisible);
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
    setModes((old) => ({ ...old, [draftId]: next }));
  };
  const isConfigured = routeChoice
    ? Boolean(selectedRoute)
    : providerSourceId && !providerSource
      ? false
      : providerSource
        ? Boolean(providerSource.baseUrl && model)
        : state.settings?.isConfigured === true;
  const configurationHint =
    routeChoice && !selectedRoute
      ? "路由组不存在，请重新选择。"
      : providerSourceId && !providerSource
        ? "当前会话绑定的模型来源已被删除，请选择该会话的模型或新建会话。"
        : providerSource && !providerSource.model
          ? "选择一个模型即可开始对话；来源会随模型自动切换。"
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
            ...(selectedRoute
              ? { routeGroupId: selectedRoute.id }
              : {
                  model,
                  ...(providerSourceId ? { providerSourceId } : {}),
                }),
            permission: mode === "plan" ? "readonly" : permission,
            mode,
          });
          if (!ok) throw new Error("加入待发队列失败。");
        }
        else if (value) throw new Error("用法：/queue [add <消息>|clear|run]");
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
              [snapshot.id]: snapshot.routeGroupId
                ? { routeGroupId: snapshot.routeGroupId }
                : {
                    ...(snapshot.providerSourceId
                      ? { sourceId: snapshot.providerSourceId }
                      : {}),
                    model: snapshot.model,
                  },
            }));
          // The command result may be a full export-shaped snapshot. Re-read only
          // the latest page instead of retaining its whole transcript in UI state.
          if (window.forge.getSessionPage) await selectSession(snapshot.id);
          else {
            dispatch({ type: "SELECT_SESSION", sessionId: snapshot.id });
            dispatch({ type: "SET_ACTIVE_SNAPSHOT", snapshot });
          }
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
    const targetDraftId = draftId;
    if (
      submitting.current.has(targetDraftId) ||
      busyDrafts.has(targetDraftId) ||
      submissions[targetDraftId] ||
      slash.executing ||
      effortSaving.current ||
      reading
    )
      return;
    if (running && state.activeSessionId && (prompt.trim() || images.length > 0)) {
      const id = state.activeSessionId;
      const capturedDraftId = targetDraftId;
      const capturedPrompt = prompt;
      const capturedImages = images;
      submitting.current.add(capturedDraftId);
      setDraftBusy(capturedDraftId, true);
      setError("");
      try {
        const accepted =
          kind === "follow-up"
            ? queueInput({
                sessionId: id,
                prompt: capturedPrompt,
                permission: mode === "plan" ? "readonly" : permission,
                mode,
                ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
                ...(selectedRoute
                  ? { routeGroupId: selectedRoute.id }
                  : {
                      model,
                      ...(providerSourceId ? { providerSourceId } : {}),
                    }),
              })
            : await sendSteering(
                capturedPrompt,
                id,
                capturedImages.length > 0 ? capturedImages : undefined,
              );
        if (!alive.current) return;
        if (accepted) {
          // Success clears this draft immediately, but never overwrites text the
          // user typed while the write was in flight.
          if (draftsRef.current[capturedDraftId] === capturedPrompt) {
            setDrafts((old) =>
              old[capturedDraftId] === capturedPrompt
                ? { ...old, [capturedDraftId]: "" }
                : old,
            );
            setManualDrafts((old) => ({ ...old, [capturedDraftId]: false }));
          }
          if (capturedImages.length > 0) {
            clearImages(capturedImages, capturedDraftId);
          }
        } else if (selectedDraft.current === capturedDraftId)
          setError("消息未确认写入，草稿已保留。请核对会话后手动发送。");
      } finally {
        // Release only this draft's own lock; a concurrent sibling keeps its own.
        submitting.current.delete(capturedDraftId);
        if (alive.current) setDraftBusy(capturedDraftId, false);
      }
      return;
    }
    if (!isConfigured) {
      setError(configurationHint);
      return;
    }
    // The pair is validated together: a model picked under one source must
    // never be submitted with another source's endpoint and credential.
    if (
      !selectedRoute &&
      pick &&
      pick.sourceId !== undefined &&
      pick.sourceId !== providerSourceId
    ) {
      setError("所选模型属于其他来源，请重新选择模型。");
      return;
    }
    if (!selectedRoute && providerSource && !providerSource.model && !model) {
      setError("请选择一个模型；来源会随模型自动切换。");
      return;
    }
    const capturedDraftId = targetDraftId;
    const capturedPrompt = prompt;
    const capturedImages = images;
    const capturedRouteId = selectedRoute?.id;
    const parsed = taskSchema.safeParse({
      workspace: isNew ? workspace : state.activeSnapshot?.workspace,
      ...(model ? { model } : {}),
      prompt,
      ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join("；"));
      return;
    }
    if (!capturedRouteId && !parsed.data.model) {
      setError("请选择一个模型。");
      return;
    }
    submitting.current.add(capturedDraftId);
    setDraftBusy(capturedDraftId, true);
    setError("");
    try {
      let id = isNew ? null : state.activeSessionId;
      if (isNew) {
        const pending = pendingNew.current;
        if (
          pending &&
          pending.workspace === parsed.data.workspace &&
          pending.model === (parsed.data.model ?? "") &&
          pending.routeGroupId === capturedRouteId
        )
          id = pending.id;
        else {
          const snapshot = await createSession(
            capturedRouteId
              ? { workspace: parsed.data.workspace, routeGroupId: capturedRouteId }
              : {
                  workspace: parsed.data.workspace,
                  ...(parsed.data.model ? { model: parsed.data.model } : {}),
                  ...(providerSourceId ? { providerSourceId } : {}),
                },
            false,
          );
          id = snapshot?.id ?? null;
          if (id)
            pendingNew.current = {
              id,
              workspace: parsed.data.workspace,
              model: parsed.data.model ?? "",
              ...(capturedRouteId ? { routeGroupId: capturedRouteId } : {}),
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
            capturedRouteId,
          )
        : false;
      if (!alive.current) return;
      if (ok && id) {
        // Acceptance settles this draft only; a sibling session may still be
        // submitting or waiting on its own run.
        setSubmissions((old) => ({
          ...old,
          [capturedDraftId]: {
            id,
            draftId: capturedDraftId,
            prompt: capturedPrompt,
            ...(capturedImages.length > 0 ? { images: capturedImages } : {}),
          },
        }));
      } else if (selectedDraft.current === capturedDraftId)
        setError("未能开始对话，草稿已保留。请检查错误详情后重试。");
    } finally {
      submitting.current.delete(capturedDraftId);
      if (alive.current) setDraftBusy(capturedDraftId, false);
    }
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
    const request = ++catalogRequest.current;
    setListing(true);
    setModelError("");
    const results = await Promise.allSettled(catalogSources.map(async (source) => {
      const models = await modelCatalogCache.load(source.key, async () => {
        if (window.forge.modelAccess && source.id) {
          const result = await window.forge.modelAccess({
            type: "catalog",
            sourceId: source.id,
            ...(refresh ? { refresh: true } : {}),
          });
          if (result.type !== "catalog") throw new Error("目录响应类型错误。");
          if (result.stale) throw new Error(result.error || "模型目录刷新失败，请重试。");
          return result.models;
        }
        // Legacy settings/hosts have only IDs; never downgrade a failed metadata read.
        return (await window.forge.listModels(source.id, refresh))
          .map((id) => ({ id, contextWindowTokens: null }));
      }, refresh);
      if (alive.current && request === catalogRequest.current)
        setCatalogs((old) => ({ ...old, [source.key]: models }));
    }));
    if (!alive.current || request !== catalogRequest.current) return;
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
  const [editingQueueItem, setEditingQueueItem] = useState<RunInput | null>(null);
  const [editingQueueText, setEditingQueueText] = useState("");
  const queueEditInputRef = useRef<HTMLTextAreaElement>(null);
  const dragQueueIndexRef = useRef<number | null>(null);
  const [draggingQueueIndex, setDraggingQueueIndex] = useState<number | null>(null);
  const [dragOverQueueIndex, setDragOverQueueIndex] = useState<number | null>(null);
  useEffect(() => {
    setEditingQueueItem(null);
    setEditingQueueText("");
    dragQueueIndexRef.current = null;
    setDraggingQueueIndex(null);
    setDragOverQueueIndex(null);
  }, [draftId]);
  useEffect(() => {
    if (editingQueueItem && !pendingInputs.includes(editingQueueItem)) {
      setEditingQueueItem(null);
      setEditingQueueText("");
    }
  }, [editingQueueItem, pendingInputs]);
  useEffect(() => {
    if (!editingQueueItem) return;
    const node = queueEditInputRef.current;
    if (node) {
      node.focus();
      const len = node.value.length;
      node.setSelectionRange(len, len);
    }
  }, [editingQueueItem]);
  const startQueueEdit = (item: RunInput) => {
    setEditingQueueItem(item);
    setEditingQueueText(item.prompt);
  };
  const cancelQueueEdit = () => {
    setEditingQueueItem(null);
    setEditingQueueText("");
  };
  const saveQueueEdit = (index: number, item: RunInput) => {
    const trimmed = editingQueueText.trim();
    if (!trimmed && (!item.images || item.images.length === 0)) return;
    const ok = updateQueuedInput ? updateQueuedInput(index, editingQueueText) : false;
    if (ok) {
      setEditingQueueItem(null);
      setEditingQueueText("");
    }
  };
  const handleQueueDragStart = (
    event: ReactDragEvent<HTMLLIElement>,
    index: number,
    item: RunInput,
  ) => {
    if (pendingInputs.length <= 1 || editingQueueItem === item) {
      event.preventDefault();
      return;
    }
    dragQueueIndexRef.current = index;
    setDraggingQueueIndex(index);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", String(index));
      } catch {
        /* ignore restricted dataTransfer in synthetic events */
      }
    }
  };
  const handleQueueDragOver = (
    event: ReactDragEvent<HTMLLIElement>,
    index: number,
  ) => {
    if (pendingInputs.length <= 1) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    if (dragOverQueueIndex !== index) {
      setDragOverQueueIndex(index);
    }
  };
  const handleQueueDrop = (
    event: ReactDragEvent<HTMLLIElement>,
    toIndex: number,
  ) => {
    event.preventDefault();
    let fromIndex = dragQueueIndexRef.current;
    if (fromIndex === null && event.dataTransfer) {
      try {
        const parsed = Number.parseInt(event.dataTransfer.getData("text/plain"), 10);
        if (!Number.isNaN(parsed)) fromIndex = parsed;
      } catch {
        /* ignore */
      }
    }
    dragQueueIndexRef.current = null;
    setDraggingQueueIndex(null);
    setDragOverQueueIndex(null);
    if (fromIndex !== null && fromIndex >= 0 && fromIndex !== toIndex) {
      reorderQueuedInputs?.(fromIndex, toIndex);
    }
  };
  const handleQueueDragEnd = () => {
    dragQueueIndexRef.current = null;
    setDraggingQueueIndex(null);
    setDragOverQueueIndex(null);
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
        </div>
        {pendingInputs.length > 0 && (
          <div
            className="composer-status composer-queue"
            role="region"
            aria-label="待发消息队列"
          >
            <div className="composer-queue-header">
              <span className="composer-queue-title">
                待发 {pendingInputs.length} 条{inputQueuePaused ? " · 已暂停" : ""}
              </span>
              {pendingInputs.length > 1 && (
                <span className="composer-queue-tip">拖动可调整顺序</span>
              )}
              <div className="composer-queue-header-btns">
                {inputQueuePaused && !running && (
                  <button
                    type="button"
                    className="composer-queue-link-btn"
                    onClick={() => resumeInputs()}
                  >
                    继续发送
                  </button>
                )}
                {pendingInputs.length > 1 && (
                  <button
                    type="button"
                    className="composer-queue-link-btn is-danger"
                    onClick={() => clearInputs()}
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
            <ol className="composer-queue-list" aria-label="待发消息列表">
              {pendingInputs.map((item, index) => {
                const isEditing = editingQueueItem === item;
                const isDragging = draggingQueueIndex === index;
                const isDragOver =
                  dragOverQueueIndex === index &&
                  draggingQueueIndex !== null &&
                  draggingQueueIndex !== index;
                const itemText = item.prompt.trim();
                const imageCount = item.images?.length ?? 0;
                const displaySummary =
                  itemText || (imageCount > 0 ? `图片 ${imageCount} 张` : "");
                return (
                  <li
                    key={queueItemKey ? queueItemKey(item) : `${index}-${item.prompt.slice(0, 24)}`}
                    className={`composer-queue-item${isDragging ? " is-dragging" : ""}${isDragOver ? " is-drag-over" : ""}${isEditing ? " is-editing" : ""}`}
                    draggable={pendingInputs.length > 1 && !isEditing}
                    onDragStart={(event) => handleQueueDragStart(event, index, item)}
                    onDragOver={(event) => handleQueueDragOver(event, index)}
                    onDragLeave={() => {
                      if (dragOverQueueIndex === index) setDragOverQueueIndex(null);
                    }}
                    onDrop={(event) => handleQueueDrop(event, index)}
                    onDragEnd={handleQueueDragEnd}
                    onKeyDown={(event) => {
                      if (isEditing) return;
                      if (event.altKey && event.key === "ArrowUp" && index > 0) {
                        event.preventDefault();
                        reorderQueuedInputs?.(index, index - 1);
                      } else if (
                        event.altKey &&
                        event.key === "ArrowDown" &&
                        index < pendingInputs.length - 1
                      ) {
                        event.preventDefault();
                        reorderQueuedInputs?.(index, index + 1);
                      }
                    }}
                  >
                    {isEditing ? (
                      <div className="composer-queue-edit-row">
                        <span className="composer-queue-index" aria-hidden="true">
                          {index + 1}
                        </span>
                        <textarea
                          ref={queueEditInputRef}
                          className="composer-queue-edit-input"
                          rows={1}
                          aria-label={`编辑第 ${index + 1} 条待发消息内容`}
                          value={editingQueueText}
                          onChange={(event) => setEditingQueueText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              cancelQueueEdit();
                            } else if (
                              event.key === "Enter" &&
                              !event.shiftKey &&
                              !event.nativeEvent.isComposing &&
                              event.nativeEvent.keyCode !== 229
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              saveQueueEdit(index, item);
                            }
                          }}
                        />
                        <div className="composer-queue-item-btns">
                          <button
                            type="button"
                            className="composer-queue-icon-btn is-confirm"
                            aria-label={`保存第 ${index + 1} 条待发消息`}
                            title="保存 (Enter)"
                            disabled={!editingQueueText.trim() && imageCount === 0}
                            onClick={() => saveQueueEdit(index, item)}
                          >
                            <Check size={13} weight="bold" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="composer-queue-icon-btn"
                            aria-label="取消编辑"
                            title="取消编辑 (Esc)"
                            onClick={cancelQueueEdit}
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span
                          className={`composer-queue-handle${pendingInputs.length > 1 ? " is-draggable" : ""}`}
                          title={pendingInputs.length > 1 ? "拖动调整顺序" : undefined}
                          aria-hidden="true"
                        >
                          <DotsSixVertical size={14} weight="bold" />
                        </span>
                        <span className="composer-queue-index" aria-hidden="true">
                          {index + 1}
                        </span>
                        <span
                          className="composer-queue-text"
                          title={item.prompt}
                          onDoubleClick={() => startQueueEdit(item)}
                        >
                          {displaySummary}
                          {itemText && imageCount > 0 ? ` · 图片 ${imageCount} 张` : ""}
                        </span>
                        <div className="composer-queue-item-btns">
                          <button
                            type="button"
                            className="composer-queue-icon-btn"
                            aria-label={`编辑第 ${index + 1} 条待发消息`}
                            title="编辑"
                            onClick={() => startQueueEdit(item)}
                          >
                            <PencilSimple size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="composer-queue-icon-btn is-danger"
                            aria-label={`取消第 ${index + 1} 条待发消息`}
                            title="取消此条待发消息"
                            onClick={() => removeQueuedInput?.(index)}
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        {(!isConfigured || error || imageError || modelUnlisted) && (
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
                当前模型 {model} 未在{providerSource?.label ? `来源 ${providerSource.label} 的` : ""}设置中启用，请先添加配置或选择已配置模型。
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
                : running
                  ? "Enter 排队，Alt+Enter 插话"
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
              models={configuredModels}
              hideSearch={true}
              sourceLabel={selectedRoute ? undefined : providerSource?.label}
              routes={routes.map((route) => ({ id: route.id, label: route.label }))}
              routeGroupId={selectedRoute?.id}
              onSelectRoute={setRoute}
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
                value: composerReasoningEffort(model, providerSource, state.settings),
                options: selectedMetadata?.reasoningEfforts,
                disabled: savingEffort || busy || !!submission || !!(providerSourceId && !providerSource),
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
          selection={{ model, sourceId: providerSourceId, metadata: selectedMetadata }}
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
