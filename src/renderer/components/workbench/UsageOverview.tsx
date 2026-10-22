import {
  ArrowsClockwise,
  Calendar,
  ChartBar,
  Cpu,
  Database,
  GitBranch,
  GlobeHemisphereWest,
  Lightning,
  Sparkle,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PublicSettings,
  SessionId,
  SessionStatus,
  SessionSummary,
  UsageStatsDto,
} from "../../shared-types";
import { configuredModelIds } from "../../state/composer-model";
import { compactTokens } from "../../state/session-usage";
import type { ActiveRunState } from "../../state/workbench-reducer";

export interface ProviderNode3D {
  readonly id: string;
  readonly label: string;
  readonly modelIds: readonly string[];
  readonly totalTokens: number;
  readonly activeSessionCount: number;
  readonly pos: readonly [number, number, number];
}

export interface ModelNode3D {
  readonly id: string;
  readonly modelId: string;
  readonly label: string;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly totalTokens: number;
  readonly runCount: number;
  readonly activeSessionCount: number;
  readonly pos: readonly [number, number, number];
}

export interface SessionEnergyConduit {
  readonly id: string;
  readonly sessionId: SessionId;
  readonly title: string;
  readonly isSubagent: boolean;
  readonly parentSessionId?: SessionId | undefined;
  readonly status: SessionStatus;
  readonly isLiveRunning: boolean;
  readonly providerId: string;
  readonly providerLabel: string;
  readonly modelNodeId: string;
  readonly modelLabel: string;
  readonly totalTokens: number;
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly phaseOffset: number;
}

export interface EnergyNetworkTopology {
  readonly providers: readonly ProviderNode3D[];
  readonly models: readonly ModelNode3D[];
  readonly activeConduits: readonly SessionEnergyConduit[];
  readonly mainSessionCount: number;
  readonly subagentSessionCount: number;
  readonly liveRunningCount: number;
}

const shortModelLabel = (model: string): string => {
  if (!model) return "未知模型";
  const withoutSource = model.includes(":")
    ? model.split(":").slice(1).join(":")
    : model;
  return withoutSource.split("/").pop() || withoutSource;
};

const stripSourcePrefix = (model: string, sourceId: string): string => {
  if (!model) return "";
  const prefix = `${sourceId}:`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
};

export function buildEnergyNetworkTopology(
  data: UsageStatsDto,
  settings: PublicSettings | null,
  sessions: readonly SessionSummary[],
  activeRuns: Readonly<Record<string, ActiveRunState>>,
  workspaceFilter?: string,
): EnergyNetworkTopology {
  const configuredSources = settings?.providerSources ?? [];
  const sourceById = new Map<
    string,
    {
      id: string;
      label: string;
      models: Set<string>;
      totalTokens: number;
    }
  >();

  // 1. Register configured provider sources and their configured models
  for (const src of configuredSources) {
    const models = new Set<string>();
    for (const m of configuredModelIds(src)) {
      const normalized = stripSourcePrefix(m, src.id);
      if (normalized) models.add(normalized);
    }
    sourceById.set(src.id, {
      id: src.id,
      label: src.label || src.id,
      models,
      totalTokens: 0,
    });
  }

  // Helper to resolve which provider a (sourceId?, model) pair belongs to
  const resolveProviderAndModel = (
    rawModel: string,
    explicitSourceId?: string,
  ): { providerId: string; providerLabel: string; modelKey: string } => {
    const cleanRaw =
      rawModel.trim() || settings?.model?.trim() || "default-model";

    if (explicitSourceId?.trim()) {
      const sid = explicitSourceId.trim();
      const existing = sourceById.get(sid);
      const modelKey = stripSourcePrefix(cleanRaw, sid) || cleanRaw;
      if (existing) {
        existing.models.add(modelKey);
        return {
          providerId: existing.id,
          providerLabel: existing.label,
          modelKey,
        };
      }
      const created = {
        id: sid,
        label: sid,
        models: new Set<string>([modelKey]),
        totalTokens: 0,
      };
      sourceById.set(sid, created);
      return { providerId: sid, providerLabel: sid, modelKey };
    }

    // Check if rawModel has "sourceId:modelName" prefix
    if (cleanRaw.includes(":")) {
      const parts = cleanRaw.split(":");
      const prefix = parts[0] ?? "";
      const rest = parts.slice(1).join(":") || cleanRaw;
      const matchedSource = sourceById.get(prefix);
      if (matchedSource) {
        matchedSource.models.add(rest);
        return {
          providerId: matchedSource.id,
          providerLabel: matchedSource.label,
          modelKey: rest,
        };
      }
      // Check if any configured source has the full string or rest string
      for (const src of sourceById.values()) {
        if (src.models.has(cleanRaw) || src.models.has(rest)) {
          const key = src.models.has(cleanRaw) ? cleanRaw : rest;
          src.models.add(key);
          return {
            providerId: src.id,
            providerLabel: src.label,
            modelKey: key,
          };
        }
      }
      const vendorId = prefix.split("/")[0] || prefix || "default";
      const entry = sourceById.get(vendorId) ?? {
        id: vendorId,
        label: vendorId,
        models: new Set<string>(),
        totalTokens: 0,
      };
      entry.models.add(rest);
      sourceById.set(vendorId, entry);
      return {
        providerId: entry.id,
        providerLabel: entry.label,
        modelKey: rest,
      };
    }

    // Check if any configured source already claims this model
    for (const src of sourceById.values()) {
      if (src.models.has(cleanRaw)) {
        return {
          providerId: src.id,
          providerLabel: src.label,
          modelKey: cleanRaw,
        };
      }
    }

    // If activeSourceId is configured in settings, use it for plain models
    if (settings?.activeSourceId && sourceById.has(settings.activeSourceId)) {
      const activeSrc = sourceById.get(settings.activeSourceId);
      if (activeSrc) {
        activeSrc.models.add(cleanRaw);
        return {
          providerId: activeSrc.id,
          providerLabel: activeSrc.label,
          modelKey: cleanRaw,
        };
      }
    }

    // If model has vendor/model format (e.g. "openai/gpt-5")
    if (cleanRaw.includes("/")) {
      const vendor = cleanRaw.split("/")[0] || "default";
      // If there is exactly 1 configured source and vendor is generic, check if we should attach or create vendor
      const entry = sourceById.get(vendor) ?? {
        id: vendor,
        label: vendor.toUpperCase(),
        models: new Set<string>(),
        totalTokens: 0,
      };
      entry.models.add(cleanRaw);
      sourceById.set(vendor, entry);
      return {
        providerId: entry.id,
        providerLabel: entry.label,
        modelKey: cleanRaw,
      };
    }

    // Fallback to first configured source or default provider
    const firstSource = configuredSources[0];
    if (firstSource) {
      const entry = sourceById.get(firstSource.id);
      if (entry) {
        entry.models.add(cleanRaw);
        return {
          providerId: entry.id,
          providerLabel: entry.label,
          modelKey: cleanRaw,
        };
      }
    }

    const defaultEntry = sourceById.get("default") ?? {
      id: "default",
      label: "默认供应商",
      models: new Set<string>(),
      totalTokens: 0,
    };
    defaultEntry.models.add(cleanRaw);
    sourceById.set("default", defaultEntry);
    return {
      providerId: defaultEntry.id,
      providerLabel: defaultEntry.label,
      modelKey: cleanRaw,
    };
  };

  // Track model token/run stats
  const modelStatsMap = new Map<
    string,
    { totalTokens: number; runCount: number }
  >();

  // 2. Incorporate route stats (which carry explicit sourceId + model)
  const rawModelToSource = new Map<string, string>();
  for (const route of data.routes ?? []) {
    rawModelToSource.set(route.model, route.sourceId);
    const resolved = resolveProviderAndModel(route.model, route.sourceId);
    const canonicalId = `${resolved.providerId}::${resolved.modelKey}`;
    const prev = modelStatsMap.get(canonicalId) ?? {
      totalTokens: 0,
      runCount: 0,
    };
    prev.totalTokens = Math.max(prev.totalTokens, route.totalTokens);
    prev.runCount = Math.max(prev.runCount, route.attempts);
    modelStatsMap.set(canonicalId, prev);
  }

  for (const req of data.requests ?? []) {
    if (req.sourceId && req.model) {
      rawModelToSource.set(req.model, req.sourceId);
    }
  }

  // 3. Incorporate model usage stats from data.models
  for (const mStat of data.models) {
    const explicitSource = rawModelToSource.get(mStat.model);
    const resolved = resolveProviderAndModel(mStat.model, explicitSource);
    const canonicalId = `${resolved.providerId}::${resolved.modelKey}`;
    const prev = modelStatsMap.get(canonicalId) ?? {
      totalTokens: 0,
      runCount: 0,
    };
    prev.totalTokens = Math.max(prev.totalTokens, mStat.totalTokens);
    prev.runCount = Math.max(prev.runCount, mStat.runCount);
    modelStatsMap.set(canonicalId, prev);
  }

  // 4. Collect ONLY currently active sessions (including active sub-agents)
  interface MergedSession {
    sessionId: SessionId;
    title: string;
    workspace: string;
    model: string;
    providerSourceId?: string | undefined;
    parentSessionId?: SessionId | undefined;
    isSubagent: boolean;
    status: SessionStatus;
    totalTokens: number;
  }

  const isActiveStatus = (status: SessionStatus | undefined): boolean =>
    status === "running" || status === "awaiting_approval";

  const sessionsById = new Map<string, SessionSummary>();
  for (const s of sessions) {
    if (!s || typeof s.id !== "string" || !s.id || s.archived) continue;
    if (workspaceFilter && s.workspace !== workspaceFilter) continue;
    sessionsById.set(s.id, s);
  }

  const getEffectiveStatus = (
    sid: string,
    fallback?: SessionStatus,
  ): SessionStatus => {
    const activeRun = activeRuns[sid];
    if (activeRun?.pendingApproval) return "awaiting_approval";
    if (activeRun?.status) return activeRun.status;
    return fallback ?? sessionsById.get(sid)?.status ?? "idle";
  };

  // Pre-collect token totals and model/source hints from topSessions & requests
  const sessionTokenTotals = new Map<string, number>();
  const sessionModelHints = new Map<string, string>();
  const sessionSourceHints = new Map<string, string>();

  for (const ts of data.topSessions) {
    if (workspaceFilter && ts.workspace !== workspaceFilter) continue;
    sessionTokenTotals.set(
      ts.sessionId,
      Math.max(sessionTokenTotals.get(ts.sessionId) ?? 0, ts.totalTokens),
    );
    if (ts.model) sessionModelHints.set(ts.sessionId, ts.model);
  }

  const requestTokensBySession = new Map<string, number>();
  for (const req of data.requests ?? []) {
    if (workspaceFilter && req.workspace !== workspaceFilter) continue;
    if (req.sourceId && !sessionSourceHints.has(req.sessionId)) {
      sessionSourceHints.set(req.sessionId, req.sourceId);
    }
    if (req.model && !sessionModelHints.has(req.sessionId)) {
      sessionModelHints.set(req.sessionId, req.model);
    }
    if (req.usage?.totalTokens) {
      requestTokensBySession.set(
        req.sessionId,
        (requestTokensBySession.get(req.sessionId) ?? 0) +
          req.usage.totalTokens,
      );
    }
  }

  const sessionMap = new Map<string, MergedSession>();

  // From state.sessions (includes both primary sessions and sub-agents with parentSessionId)
  for (const s of sessionsById.values()) {
    const effectiveStatus = getEffectiveStatus(s.id, s.status);
    if (!isActiveStatus(effectiveStatus)) continue;

    // If this is a sub-agent whose parent session is known and already finished,
    // ignore stale status unless the sub-agent itself has a live activeRun entry.
    if (s.parentSessionId && sessionsById.has(s.parentSessionId)) {
      const parentStatus = getEffectiveStatus(s.parentSessionId);
      const hasDirectActiveRun =
        Boolean(activeRuns[s.id]?.pendingApproval) ||
        isActiveStatus(activeRuns[s.id]?.status);
      if (!isActiveStatus(parentStatus) && !hasDirectActiveRun) {
        continue;
      }
    }

    const totalTokens = Math.max(
      sessionTokenTotals.get(s.id) ?? 0,
      requestTokensBySession.get(s.id) ?? 0,
    );

    sessionMap.set(s.id, {
      sessionId: s.id,
      title: s.title || (s.parentSessionId ? "子代理任务" : "未命名会话"),
      workspace: s.workspace || "",
      model:
        s.model ||
        sessionModelHints.get(s.id) ||
        settings?.model ||
        "default-model",
      providerSourceId: s.providerSourceId ?? sessionSourceHints.get(s.id),
      parentSessionId: s.parentSessionId,
      isSubagent: Boolean(s.parentSessionId),
      status: effectiveStatus,
      totalTokens,
    });
  }

  // Also include any live activeRuns not yet present in state.sessions
  for (const [sid, run] of Object.entries(activeRuns)) {
    if (sessionMap.has(sid)) continue;
    const effectiveStatus: SessionStatus = run.pendingApproval
      ? "awaiting_approval"
      : run.status;
    if (!isActiveStatus(effectiveStatus)) continue;
    const knownSession = sessionsById.get(sid);
    sessionMap.set(sid, {
      sessionId: run.sessionId,
      title: knownSession?.title || "实时运行会话",
      workspace: knownSession?.workspace ?? workspaceFilter ?? "",
      model:
        knownSession?.model ||
        sessionModelHints.get(sid) ||
        settings?.model ||
        "default-model",
      providerSourceId:
        knownSession?.providerSourceId ??
        sessionSourceHints.get(sid) ??
        settings?.activeSourceId,
      parentSessionId: knownSession?.parentSessionId,
      isSubagent: Boolean(knownSession?.parentSessionId),
      status: effectiveStatus,
      totalTokens: Math.max(
        sessionTokenTotals.get(sid) ?? 0,
        requestTokensBySession.get(sid) ?? 0,
      ),
    });
  }

  // Fallback for in-flight requests (strictly outcome === "started") when state.sessions does not list the session
  for (const req of data.requests ?? []) {
    if (workspaceFilter && req.workspace !== workspaceFilter) continue;
    if (req.outcome !== "started") continue;
    if (sessionMap.has(req.sessionId) || sessionsById.has(req.sessionId)) {
      continue;
    }
    sessionMap.set(req.sessionId, {
      sessionId: req.sessionId,
      title: req.sessionTitle || "会话",
      workspace: req.workspace,
      model: req.model || settings?.model || "default-model",
      providerSourceId: req.sourceId,
      isSubagent: false,
      status: "running",
      totalTokens: Math.max(
        sessionTokenTotals.get(req.sessionId) ?? 0,
        requestTokensBySession.get(req.sessionId) ?? 0,
      ),
    });
  }

  // Ensure at least one provider & model exist for the 3D periphery even on empty state
  if (sourceById.size === 0) {
    const fallbackModel = settings?.model?.trim() || "forge-default";
    sourceById.set("default", {
      id: "default",
      label: "默认供应商",
      models: new Set([fallbackModel]),
      totalTokens: 0,
    });
  }

  // Build session conduits and count active sessions per provider/model
  const modelSessionCounter = new Map<string, number>();
  const providerSessionCounter = new Map<string, number>();

  interface RawConduit {
    session: MergedSession;
    providerId: string;
    providerLabel: string;
    modelNodeId: string;
    modelLabel: string;
    isLiveRunning: boolean;
  }

  const rawConduits: RawConduit[] = [];
  for (const s of sessionMap.values()) {
    const explicitSource = s.providerSourceId ?? rawModelToSource.get(s.model);
    const resolved = resolveProviderAndModel(s.model, explicitSource);
    const modelNodeId = `${resolved.providerId}::${resolved.modelKey}`;

    modelSessionCounter.set(
      modelNodeId,
      (modelSessionCounter.get(modelNodeId) ?? 0) + 1,
    );
    providerSessionCounter.set(
      resolved.providerId,
      (providerSessionCounter.get(resolved.providerId) ?? 0) + 1,
    );

    rawConduits.push({
      session: s,
      providerId: resolved.providerId,
      providerLabel: resolved.providerLabel,
      modelNodeId,
      modelLabel: shortModelLabel(resolved.modelKey),
      isLiveRunning: true,
    });
  }

  // Ensure every provider has at least one model node so the 3D periphery is complete
  for (const src of sourceById.values()) {
    if (src.models.size === 0) {
      src.models.add(settings?.model?.trim() || "未配置模型");
    }
  }

  // 5. Compute 3D positions:
  // Outer orbital ring (r = 250): Model Providers
  // Middle orbital ring (r = 152): Active Models (or 1 primary model per provider when idle)
  // Center (0, 0, 0): Forge Core
  // This outside-in radial hierarchy (Provider -> Model -> Forge) guarantees feeder links and energy conduits never cross.
  const providerList = Array.from(sourceById.values());
  const providerCount = providerList.length;
  const providerRadius = providerCount === 1 ? 236 : 250;
  const modelRadius = 152;
  const hasAnyActiveSession = rawConduits.length > 0;

  // Determine which models to place on the 3D stage per provider:
  // When sessions are active, ONLY show models that currently have active sessions (eliminating idle blue balls).
  // When completely idle (0 active sessions), show at most 1 primary model per provider.
  const visibleModelsByProvider = new Map<string, string[]>();
  for (const prov of providerList) {
    const allKeys = Array.from(prov.models);
    const activeKeys = allKeys.filter(
      (mKey) => (modelSessionCounter.get(`${prov.id}::${mKey}`) ?? 0) > 0,
    );
    if (hasAnyActiveSession) {
      visibleModelsByProvider.set(prov.id, activeKeys);
    } else {
      const topKey = [...allKeys].sort((a, b) => {
        const ta = modelStatsMap.get(`${prov.id}::${a}`)?.totalTokens ?? 0;
        const tb = modelStatsMap.get(`${prov.id}::${b}`)?.totalTokens ?? 0;
        return tb - ta;
      })[0];
      visibleModelsByProvider.set(prov.id, topKey ? [topKey] : []);
    }
  }

  const providerWeights = providerList.map((p) => {
    const visibleCount = visibleModelsByProvider.get(p.id)?.length ?? 0;
    return 1 + visibleCount * 1.15;
  });
  const totalWeight =
    providerWeights.reduce((acc, w) => acc + w, 0) ||
    Math.max(providerCount, 1);

  const providers3D: ProviderNode3D[] = [];
  const models3D: ModelNode3D[] = [];

  let cumulativeAngle = -Math.PI / 2;
  providerList.forEach((prov, pIdx) => {
    const weight = providerWeights[pIdx] ?? 1;
    const allocatedSpan = (weight / totalWeight) * Math.PI * 2;
    const baseAngle = cumulativeAngle + allocatedSpan * 0.5;
    cumulativeAngle += allocatedSpan;

    const provX = Math.cos(baseAngle) * providerRadius;
    const provZ = Math.sin(baseAngle) * providerRadius;
    const provY = 0;

    let providerTokens = 0;
    for (const mKey of prov.models) {
      providerTokens +=
        modelStatsMap.get(`${prov.id}::${mKey}`)?.totalTokens ?? 0;
    }

    const visibleKeys = visibleModelsByProvider.get(prov.id) ?? [];
    const childModelNodeIds: string[] = [];

    visibleKeys.forEach((mKey, mIdx) => {
      const canonicalId = `${prov.id}::${mKey}`;
      childModelNodeIds.push(canonicalId);
      const mStat = modelStatsMap.get(canonicalId);
      const tokens = mStat?.totalTokens ?? 0;
      const runs = mStat?.runCount ?? 0;

      // Spread multiple active models of the same provider cleanly across its angular sector
      const stepAngle =
        visibleKeys.length <= 1
          ? 0
          : Math.min(
              0.72,
              (allocatedSpan * 0.72) / Math.max(1, visibleKeys.length - 1),
            );
      const centeredIdx = mIdx - (visibleKeys.length - 1) * 0.5;
      const mAngle = baseAngle + centeredIdx * stepAngle;

      const mx = Math.cos(mAngle) * modelRadius;
      const mz = Math.sin(mAngle) * modelRadius;
      const my = 0;

      models3D.push({
        id: canonicalId,
        modelId: mKey,
        label: shortModelLabel(mKey),
        providerId: prov.id,
        providerLabel: prov.label,
        totalTokens: tokens,
        runCount: runs,
        activeSessionCount: modelSessionCounter.get(canonicalId) ?? 0,
        pos: [mx, my, mz],
      });
    });

    providers3D.push({
      id: prov.id,
      label: prov.label,
      modelIds: childModelNodeIds,
      totalTokens: providerTokens,
      activeSessionCount: providerSessionCounter.get(prov.id) ?? 0,
      pos: [provX, provY, provZ],
    });
  });

  // Group conduits by modelNodeId so multiple active sessions on the same model fan out cleanly in 3D
  const byModel = new Map<string, RawConduit[]>();
  for (const rc of rawConduits) {
    const group = byModel.get(rc.modelNodeId) ?? [];
    group.push(rc);
    byModel.set(rc.modelNodeId, group);
  }

  const activeConduits: SessionEnergyConduit[] = [];
  let conduitIdx = 0;
  for (const group of byModel.values()) {
    group.forEach((rc, siblingIndex) => {
      activeConduits.push({
        id: `conduit-${rc.session.sessionId}`,
        sessionId: rc.session.sessionId,
        title: rc.session.title,
        isSubagent: rc.session.isSubagent,
        parentSessionId: rc.session.parentSessionId,
        status: rc.session.status,
        isLiveRunning: rc.isLiveRunning,
        providerId: rc.providerId,
        providerLabel: rc.providerLabel,
        modelNodeId: rc.modelNodeId,
        modelLabel: rc.modelLabel,
        totalTokens: rc.session.totalTokens,
        siblingIndex,
        siblingCount: group.length,
        phaseOffset: (conduitIdx * 0.23) % 1,
      });
      conduitIdx += 1;
    });
  }

  const subagentSessionCount = activeConduits.filter(
    (c) => c.isSubagent,
  ).length;
  const mainSessionCount = activeConduits.length - subagentSessionCount;

  return {
    providers: providers3D,
    models: models3D,
    activeConduits,
    mainSessionCount,
    subagentSessionCount,
    liveRunningCount: activeConduits.length,
  };
}

/**
 * Computes the energy transmission speed multiplier from the number of connected sessions.
 * More sessions (including sub-agents) -> more energy lines -> faster energy transfer.
 */
export function computeEnergyTransferSpeed(
  conduitCount: number,
  liveRunningCount: number,
): number {
  if (conduitCount <= 0) return 0;
  const sessionFactor = 1 + (conduitCount - 1) * 0.38;
  const liveBoost = liveRunningCount * 0.24;
  return Number((sessionFactor + liveBoost).toFixed(2));
}

type Vec3 = readonly [number, number, number];

function rotateY(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

function rotateX(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function transformPoint(p: Vec3, yaw: number, pitch: number): Vec3 {
  return rotateX(rotateY(p, yaw), pitch);
}

function projectPoint(
  p: Vec3,
  cx: number,
  cy: number,
  fov: number,
  sceneScale: number,
): { x: number; y: number; z: number; scale: number } {
  const scaled: Vec3 = [
    p[0] * sceneScale,
    p[1] * sceneScale,
    p[2] * sceneScale,
  ];
  const depth = Math.max(fov + scaled[2], 120);
  const scale = fov / depth;
  return {
    x: cx + scaled[0] * scale,
    y: cy + scaled[1] * scale,
    z: scaled[2],
    scale,
  };
}

function quadraticBezier3D(p0: Vec3, p1: Vec3, p2: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const ut2 = 2 * u * t;
  return [
    uu * p0[0] + ut2 * p1[0] + tt * p2[0],
    uu * p0[1] + ut2 * p1[1] + tt * p2[1],
    uu * p0[2] + ut2 * p1[2] + tt * p2[2],
  ];
}

/**
 * Computes a smooth, non-crossing laminar 3D control point for a session conduit
 * between a Model node and Forge (0,0,0), so multiple active sessions on the same
 * model fan out as a symmetric parallel ribbon without crossing.
 */
function conduitControlPoint(
  modelPos: Vec3,
  siblingIndex: number,
  siblingCount: number,
): Vec3 {
  const midX = modelPos[0] * 0.5;
  const midY = modelPos[1] * 0.5;
  const midZ = modelPos[2] * 0.5;

  // Tangent perpendicular in XZ plane
  const lenXZ = Math.hypot(modelPos[0], modelPos[2]) || 1;
  const perpX = -modelPos[2] / lenXZ;
  const perpZ = modelPos[0] / lenXZ;

  // Monotonic spread in [-1, 1] with uniform upward lift so sibling curves never cross in 2D projection
  const normalizedSpread =
    siblingCount <= 1 ? 0 : (siblingIndex / (siblingCount - 1)) * 2 - 1;
  const maxLateral = Math.min(26, 7 + siblingCount * 5.5);
  const lateralSpread = normalizedSpread * maxLateral;
  const verticalLift = 8 + (1 - Math.abs(normalizedSpread) * 0.45) * 6;

  return [
    midX + perpX * lateralSpread,
    midY - verticalLift,
    midZ + perpZ * lateralSpread,
  ];
}

export function UsageOverview({
  kpiCards,
  data,
  settings,
  sessions,
  activeRuns,
  workspaceFilter,
  onSelectSession,
}: {
  readonly kpiCards: ReactNode;
  readonly data: UsageStatsDto;
  readonly settings: PublicSettings | null;
  readonly sessions: readonly SessionSummary[];
  readonly activeRuns: Readonly<Record<string, ActiveRunState>>;
  readonly workspaceFilter?: string | undefined;
  readonly onSelectSession: (sessionId: SessionId) => void;
}) {
  // Ignore high-frequency streaming text/reasoning deltas on activeRuns:
  // only recompute topology when session IDs, statuses, or pending approvals actually change.
  const activeRunsKey = Object.entries(activeRuns)
    .map(
      ([sid, run]) =>
        `${sid}:${run?.pendingApproval ? "awaiting_approval" : (run?.status ?? "")}`,
    )
    .sort()
    .join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by activeRunsKey to avoid rebuilding topology on every streaming token delta
  const stableActiveRuns = useMemo(() => activeRuns, [activeRunsKey]);

  const topology = useMemo(
    () =>
      buildEnergyNetworkTopology(
        data,
        settings,
        sessions,
        stableActiveRuns,
        workspaceFilter,
      ),
    [data, settings, sessions, stableActiveRuns, workspaceFilter],
  );

  const [selectedConduitId, setSelectedConduitId] = useState<string | null>(
    null,
  );
  const [hoveredNodeLabel, setHoveredNodeLabel] = useState<string | null>(null);

  const activeConduits = topology.activeConduits;
  const activeSubagentCount = topology.subagentSessionCount;
  const activeMainCount = topology.mainSessionCount;
  const activeLiveCount = topology.liveRunningCount;

  const transferSpeed = useMemo(
    () => computeEnergyTransferSpeed(activeConduits.length, activeLiveCount),
    [activeConduits.length, activeLiveCount],
  );

  // Speed progress percentage (capped at 100% around 8+ sessions for visual meter)
  const speedMeterPercent =
    activeConduits.length === 0
      ? 0
      : Math.min(100, Math.round((transferSpeed / 4.0) * 100));

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const cameraRef = useRef({
    yaw: 0.35,
    pitch: 0.38,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    energyPhase: 0,
    corePhase: 0,
    lastFrameTime: 0,
  });

  // Lookup maps & primary label set memoized once per topology change
  const topologyLookups = useMemo(() => {
    const modelById = new Map<string, ModelNode3D>();
    for (const m of topology.models) {
      modelById.set(m.id, m);
    }
    const providerById = new Map<string, ProviderNode3D>();
    for (const p of topology.providers) {
      providerById.set(p.id, p);
    }
    const primaryModelIds = new Set<string>();
    for (const p of topology.providers) {
      const childModels = topology.models.filter((m) => m.providerId === p.id);
      const topModel = [...childModels].sort(
        (a, b) =>
          b.activeSessionCount - a.activeSessionCount ||
          b.totalTokens - a.totalTokens,
      )[0];
      if (topModel) primaryModelIds.add(topModel.id);
    }
    return { modelById, providerById, primaryModelIds };
  }, [topology]);

  // Keep latest scene inputs in a ref so the RAF loop never restarts or stacks on React re-renders
  const sceneStateRef = useRef({
    topology,
    topologyLookups,
    activeConduits,
    activeMainCount,
    activeSubagentCount,
    transferSpeed,
    selectedConduitId,
  });
  sceneStateRef.current = {
    topology,
    topologyLookups,
    activeConduits,
    activeMainCount,
    activeSubagentCount,
    transferSpeed,
    selectedConduitId,
  };

  // Hit targets populated on each frame for pointer hover/click
  const hitNodesRef = useRef<
    Array<{
      x: number;
      y: number;
      r: number;
      label: string;
      conduitId?: string | undefined;
    }>
  >([]);

  const drawScene = useCallback((now: number, advancePhase: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const {
      topology: curTopology,
      topologyLookups: lookups,
      activeConduits: curConduits,
      activeMainCount: curMainCount,
      activeSubagentCount: curSubCount,
      transferSpeed: curSpeed,
      selectedConduitId: curSelectedId,
    } = sceneStateRef.current;

    const cam = cameraRef.current;
    const dt =
      cam.lastFrameTime > 0
        ? Math.max(0, Math.min((now - cam.lastFrameTime) / 1000, 0.05))
        : 0;
    cam.lastFrameTime = now;

    if (advancePhase && curConduits.length > 0) {
      // Only energy particles flow along conduits; peripheral nodes NEVER auto-rotate
      const flowRate = 0.22 * Math.min(curSpeed, 3.2);
      cam.energyPhase = (cam.energyPhase + dt * flowRate) % 1000;
      cam.corePhase = (cam.corePhase + dt * 1.2) % (Math.PI * 20);
    }

    const cssWidth =
      canvasSizeRef.current.width ||
      canvas.clientWidth ||
      canvas.getBoundingClientRect().width;
    const cssHeight =
      canvasSizeRef.current.height ||
      canvas.clientHeight ||
      canvas.getBoundingClientRect().height;
    const width = Math.max(cssWidth, 300);
    const height = Math.max(cssHeight, 360);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const isDark =
      document.documentElement.getAttribute("data-theme") === "dark" ||
      document.documentElement.dataset.theme === "dark";

    // Palette aligned with DESIGN.md Warm Light-First & Charcoal Dark tokens
    const bgCenter = isDark ? "#20221f" : "#f7f6f1";
    const bgEdge = isDark ? "#151614" : "#efeee8";
    const orbitRingStroke = isDark
      ? "rgba(170, 167, 159, 0.16)"
      : "rgba(104, 102, 95, 0.16)";
    const activeTetherStroke = isDark
      ? "rgba(220, 148, 119, 0.55)"
      : "rgba(165, 79, 53, 0.48)";
    const textPrimary = isDark ? "#eeede8" : "#292824";
    const textSecondary = isDark ? "#aaa79f" : "#68665f";
    const forgeCoreMain = isDark ? "#dc9477" : "#a54f35";
    const forgeCoreGlow = isDark
      ? "rgba(220, 148, 119, 0.34)"
      : "rgba(165, 79, 53, 0.24)";
    const providerFill = isDark ? "#2c332a" : "#e7ece3";
    const providerStroke = isDark ? "#8fad82" : "#55684d";
    const modelFill = isDark ? "#282522" : "#f6f2ec";
    const modelStroke = isDark ? "#b89f8d" : "#8c7362";
    const mainConduitColor = isDark ? "#dc9477" : "#a54f35";
    const subagentConduitColor = isDark ? "#56b881" : "#226d40";
    const fontSans =
      '"Geist", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    const fontMono = '"Geist Mono", "SFMono-Regular", monospace';

    // Background radial gradient
    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      20,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.65,
    );
    bgGrad.addColorStop(0, bgCenter);
    bgGrad.addColorStop(1, bgEdge);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.52;
    const fov = 640;
    const minDim = Math.min(width, height);
    const sceneScale = Math.max(0.54, Math.min(1.08, minDim / 610));

    // Draw 3D orbital reference rings (Middle Model orbit = 152, Outer Provider orbit = 250)
    for (const orbitRadius of [152, 250]) {
      ctx.beginPath();
      const segments = 64;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const pt3d: Vec3 = [
          Math.cos(theta) * orbitRadius,
          0,
          Math.sin(theta) * orbitRadius,
        ];
        const rotated = transformPoint(pt3d, cam.yaw, cam.pitch);
        const proj = projectPoint(rotated, cx, cy, fov, sceneScale);
        if (i === 0) ctx.moveTo(proj.x, proj.y);
        else ctx.lineTo(proj.x, proj.y);
      }
      ctx.strokeStyle = orbitRingStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw clean radial Provider (outer) -> Model (middle) feeder links
    for (const mNode of curTopology.models) {
      if (mNode.activeSessionCount <= 0) continue;
      const pNode = lookups.providerById.get(mNode.providerId);
      if (!pNode) continue;
      const pRot = transformPoint(pNode.pos, cam.yaw, cam.pitch);
      const mRot = transformPoint(mNode.pos, cam.yaw, cam.pitch);
      const pProj = projectPoint(pRot, cx, cy, fov, sceneScale);
      const mProj = projectPoint(mRot, cx, cy, fov, sceneScale);

      // Clip endpoints slightly so line connects between hexagon edge and model ring edge
      const sx = pProj.x + (mProj.x - pProj.x) * 0.16;
      const sy = pProj.y + (mProj.y - pProj.y) * 0.16;
      const ex = pProj.x + (mProj.x - pProj.x) * 0.84;
      const ey = pProj.y + (mProj.y - pProj.y) * 0.84;

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = activeTetherStroke;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Draw Session Energy Conduits (Model (middle orbit) -> Forge Core (0,0,0))
    const forgeCenter3D: Vec3 = [0, 0, 0];
    const forgeCenterProj = projectPoint(
      forgeCenter3D,
      cx,
      cy,
      fov,
      sceneScale,
    );

    const tStart = 0.12;
    const tEnd = 0.82;
    const tSpan = tEnd - tStart;

    for (const conduit of curConduits) {
      const mNode = lookups.modelById.get(conduit.modelNodeId);
      if (!mNode) continue;

      const cp3D = conduitControlPoint(
        mNode.pos,
        conduit.siblingIndex,
        conduit.siblingCount,
      );

      const isSelected = curSelectedId === conduit.id;
      const baseColor = conduit.isSubagent
        ? subagentConduitColor
        : mainConduitColor;

      // Sample clipped 3D curve points from Model edge (tStart) -> Forge edge (tEnd)
      const steps = 22;
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const t = tStart + (s / steps) * tSpan;
        const pt3D = quadraticBezier3D(mNode.pos, cp3D, forgeCenter3D, t);
        const rot = transformPoint(pt3D, cam.yaw, cam.pitch);
        const proj = projectPoint(rot, cx, cy, fov, sceneScale);
        if (s === 0) ctx.moveTo(proj.x, proj.y);
        else ctx.lineTo(proj.x, proj.y);
      }

      ctx.lineCap = "round";

      // Soft ambient glow pass
      ctx.strokeStyle = baseColor;
      ctx.globalAlpha = isSelected ? 0.28 : 0.13;
      ctx.lineWidth = isSelected ? 4.5 : 3.2;
      ctx.stroke();

      // Crisp core conduit curve
      ctx.globalAlpha = isSelected ? 0.92 : 0.52;
      ctx.lineWidth = isSelected ? 2.1 : 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Sleek curved energy pulse gliding along the conduit from Model -> Forge
      const pulseCount = curConduits.length <= 2 ? 2 : 1;
      for (let p = 0; p < pulseCount; p++) {
        const rawProgress =
          (cam.energyPhase + conduit.phaseOffset + p / pulseCount) % 1;
        const progress = rawProgress < 0 ? rawProgress + 1 : rawProgress;
        const headT = tStart + progress * tSpan;
        const tailT = Math.max(tStart, headT - 0.16);

        const head3D = quadraticBezier3D(mNode.pos, cp3D, forgeCenter3D, headT);
        const headProj = projectPoint(
          transformPoint(head3D, cam.yaw, cam.pitch),
          cx,
          cy,
          fov,
          sceneScale,
        );
        const tail3D = quadraticBezier3D(mNode.pos, cp3D, forgeCenter3D, tailT);
        const tailProj = projectPoint(
          transformPoint(tail3D, cam.yaw, cam.pitch),
          cx,
          cy,
          fov,
          sceneScale,
        );

        // Draw curved comet streak following the Bezier path
        const streakSteps = 6;
        ctx.beginPath();
        for (let ss = 0; ss <= streakSteps; ss++) {
          const st = tailT + (ss / streakSteps) * (headT - tailT);
          const sPt = quadraticBezier3D(mNode.pos, cp3D, forgeCenter3D, st);
          const sProj = projectPoint(
            transformPoint(sPt, cam.yaw, cam.pitch),
            cx,
            cy,
            fov,
            sceneScale,
          );
          if (ss === 0) ctx.moveTo(sProj.x, sProj.y);
          else ctx.lineTo(sProj.x, sProj.y);
        }

        const grad = ctx.createLinearGradient(
          tailProj.x,
          tailProj.y,
          headProj.x,
          headProj.y,
        );
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, baseColor);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.4 * headProj.scale;
        ctx.stroke();

        // Subtle glowing pulse tip
        const tipRadius = 2.2 * headProj.scale;
        ctx.beginPath();
        ctx.arc(headProj.x, headProj.y, tipRadius, 0, Math.PI * 2);
        ctx.fillStyle = baseColor;
        ctx.fill();
      }
    }

    // Collect all 3D nodes (Providers, Models, and Central Forge Core) and depth-sort back-to-front
    type RenderableNode =
      | {
          kind: "provider";
          z: number;
          proj: { x: number; y: number; scale: number };
          node: ProviderNode3D;
        }
      | {
          kind: "model";
          z: number;
          proj: { x: number; y: number; scale: number };
          node: ModelNode3D;
        }
      | {
          kind: "forge";
          z: number;
          proj: { x: number; y: number; scale: number };
        };

    const renderQueue: RenderableNode[] = [
      { kind: "forge", z: 0, proj: forgeCenterProj },
    ];

    for (const pNode of curTopology.providers) {
      const rot = transformPoint(pNode.pos, cam.yaw, cam.pitch);
      const proj = projectPoint(rot, cx, cy, fov, sceneScale);
      renderQueue.push({ kind: "provider", z: rot[2], proj, node: pNode });
    }

    for (const mNode of curTopology.models) {
      const rot = transformPoint(mNode.pos, cam.yaw, cam.pitch);
      const proj = projectPoint(rot, cx, cy, fov, sceneScale);
      renderQueue.push({ kind: "model", z: rot[2], proj, node: mNode });
    }

    // Depth sort: farthest (negative z) drawn first, closest (positive z) drawn last
    renderQueue.sort((a, b) => a.z - b.z);

    const newHitNodes: Array<{
      x: number;
      y: number;
      r: number;
      label: string;
    }> = [];

    for (const item of renderQueue) {
      if (item.kind === "forge") {
        const { x, y, scale } = item.proj;
        const coreR = 26 * scale;
        const pulseBoost =
          curConduits.length > 0 ? 1 + Math.sin(cam.corePhase) * 0.05 : 1;

        // Soft outer radial aura glow
        const auraR = coreR * 2.1 * pulseBoost;
        const aura = ctx.createRadialGradient(x, y, coreR * 0.2, x, y, auraR);
        aura.addColorStop(0, forgeCoreGlow);
        aura.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(x, y, auraR, 0, Math.PI * 2);
        ctx.fillStyle = aura;
        ctx.fill();

        // Single clean concentric 3D orbital halo ring around Forge Core
        ctx.beginPath();
        const haloSegs = 40;
        const haloRadius = 38;
        for (let i = 0; i <= haloSegs; i++) {
          const a = (i / haloSegs) * Math.PI * 2;
          const pt3d: Vec3 = [
            Math.cos(a) * haloRadius,
            0,
            Math.sin(a) * haloRadius,
          ];
          const gp = projectPoint(
            transformPoint(pt3d, cam.yaw, cam.pitch),
            cx,
            cy,
            fov,
            sceneScale,
          );
          if (i === 0) ctx.moveTo(gp.x, gp.y);
          else ctx.lineTo(gp.x, gp.y);
        }
        ctx.strokeStyle = forgeCoreMain;
        ctx.globalAlpha = curConduits.length > 0 ? 0.45 : 0.25;
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Crisp inner containment ring
        ctx.beginPath();
        ctx.arc(x, y, coreR * 0.84, 0, Math.PI * 2);
        ctx.strokeStyle = forgeCoreMain;
        ctx.globalAlpha = 0.36;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Inner solid energy sphere
        ctx.beginPath();
        ctx.arc(x, y, coreR * 0.58 * pulseBoost, 0, Math.PI * 2);
        ctx.fillStyle = forgeCoreMain;
        ctx.fill();

        // Label "FORGE"
        ctx.font = `700 ${Math.round(13 * scale)}px ${fontSans}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = textPrimary;
        ctx.fillText("FORGE", x, y + coreR + 12 * scale);

        const rateSub =
          curConduits.length > 0
            ? `${curConduits.length} 通道 · ${curSpeed}x`
            : "待机轨道";
        ctx.font = `500 ${Math.round(10 * scale)}px ${fontMono}`;
        ctx.fillStyle = textSecondary;
        ctx.fillText(rateSub, x, y + coreR + 26 * scale);

        newHitNodes.push({
          x,
          y,
          r: coreR * 1.2,
          label: `Forge 核心 · ${curConduits.length} 条会话能量线 (${curMainCount} 主会话 / ${curSubCount} 子代理) · 传输速率 ${curSpeed}x`,
        });
      } else if (item.kind === "provider") {
        const { x, y, scale } = item.proj;
        const pNode = item.node;
        const r = (pNode.activeSessionCount > 0 ? 16 : 13) * scale;

        // Hexagon hub for Provider
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const hx = x + Math.cos(a) * r;
          const hy = y + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fillStyle = providerFill;
        ctx.fill();
        ctx.lineWidth = pNode.activeSessionCount > 0 ? 2.2 : 1.4;
        ctx.strokeStyle = providerStroke;
        ctx.stroke();

        // Inner dot
        ctx.beginPath();
        ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = providerStroke;
        ctx.fill();

        // Provider Label
        ctx.font = `600 ${Math.max(10, Math.round(11 * scale))}px ${fontSans}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = textPrimary;
        ctx.fillText(pNode.label, x, y + r + 5 * scale);

        newHitNodes.push({
          x,
          y,
          r: r + 8,
          label: `供应商：${pNode.label} · ${pNode.modelIds.length} 个模型 · ${pNode.activeSessionCount} 个活跃连接 · ${compactTokens(pNode.totalTokens)} tokens`,
        });
      } else {
        const { x, y, scale } = item.proj;
        const mNode = item.node;
        const hasActive = mNode.activeSessionCount > 0;
        const r = (hasActive ? 11 : 8.5) * scale;

        if (hasActive) {
          ctx.beginPath();
          ctx.arc(x, y, r * 1.65, 0, Math.PI * 2);
          ctx.strokeStyle = mainConduitColor;
          ctx.globalAlpha = 0.38;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = modelFill;
        ctx.fill();
        ctx.lineWidth = hasActive ? 2 : 1.3;
        ctx.strokeStyle = hasActive ? mainConduitColor : modelStroke;
        ctx.stroke();

        // Session count badge on model node if active
        if (hasActive) {
          ctx.font = `700 ${Math.max(8, Math.round(9 * scale))}px ${fontMono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = textPrimary;
          ctx.fillText(String(mNode.activeSessionCount), x, y);
        }

        // Model short name: always render for energized models, primary provider models, or when total models <= 12
        const showModelLabel =
          hasActive ||
          curTopology.models.length <= 12 ||
          lookups.primaryModelIds.has(mNode.id);
        if (showModelLabel) {
          ctx.font = `500 ${Math.max(9, Math.round(10.5 * scale))}px ${fontMono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = hasActive ? textPrimary : textSecondary;
          ctx.fillText(mNode.label, x, y + r + 4 * scale);
        }

        newHitNodes.push({
          x,
          y,
          r: r + 8,
          label: `模型：${mNode.modelId} (${mNode.providerLabel}) · ${mNode.activeSessionCount} 条能量连接 · ${compactTokens(mNode.totalTokens)} tokens`,
        });
      }
    }

    hitNodesRef.current = newHitNodes;
    ctx.restore();
  }, []);

  const resetCamera = useCallback(() => {
    cameraRef.current.yaw = 0.35;
    cameraRef.current.pitch = 0.38;
    drawScene(performance.now(), false);
  }, [drawScene]);

  // Track canvas container size without calling getBoundingClientRect() on every frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvasSizeRef.current = { width: rect.width, height: rect.height };

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          canvasSizeRef.current = {
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          };
        }
        drawScene(performance.now(), false);
      });
      ro.observe(canvas);
      return () => ro.disconnect();
    }
    return undefined;
  }, [drawScene]);

  // Redraw static frame immediately whenever topology or selection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally redraws when topology or selection updates
  useEffect(() => {
    drawScene(performance.now(), false);
  }, [topology, selectedConduitId, drawScene]);

  // Single guarded RAF loop ONLY when there are active conduits transmitting energy
  const hasActiveConduits = activeConduits.length > 0;
  useEffect(() => {
    if (!hasActiveConduits) return;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    let cancelled = false;
    let animationFrameId = 0;
    cameraRef.current.lastFrameTime = performance.now();

    const tick = (now: number) => {
      if (cancelled) return;
      drawScene(now, true);
      if (!cancelled) {
        animationFrameId = window.requestAnimationFrame(tick);
      }
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [hasActiveConduits, drawScene]);

  return (
    <div
      id="tabpanel-usage-overview"
      role="tabpanel"
      aria-labelledby="tab-btn-usage-overview"
      className="usage-overview"
    >
      {/* 1. 总量卡片 (Total Summary KPI Cards) */}
      {kpiCards}

      {/* 2. 3D Forge 能量网络可视化 (3D Forge Energy Network Visualization) */}
      <section
        className="usage-dashboard-section usage-overview-3d-section"
        data-testid="usage-overview-3d"
        data-provider-count={topology.providers.length}
        data-model-count={topology.models.length}
        data-session-line-count={activeConduits.length}
        data-subagent-count={activeSubagentCount}
        data-energy-speed={transferSpeed}
        aria-label="Forge 3D 能量传输网络"
      >
        <div className="usage-section-header">
          <div className="usage-section-title-group">
            <span className="usage-section-title">
              <GlobeHemisphereWest size={16} weight="duotone" />
              Forge 3D 能量传输矩阵
            </span>
            <span className="usage-section-subtitle-meta">
              中心 Forge 核心 · 周边 {topology.providers.length} 个供应商与{" "}
              {topology.models.length} 个模型 · 当前活跃会话与子代理实时能量汇聚
            </span>
          </div>

          <div className="usage-section-header-right">
            <div className="usage-3d-camera-actions">
              <button
                type="button"
                className="usage-dashboard-btn"
                onClick={resetCamera}
                title="重置 3D 视角"
              >
                <ArrowsClockwise size={13} />
                <span>重置视角</span>
              </button>
            </div>
          </div>
        </div>

        {/* Energy Status Telemetry Strip */}
        <div className="usage-energy-telemetry-bar">
          <div className="usage-energy-telemetry-item">
            <span className="usage-energy-telemetry-label">中心枢纽</span>
            <strong className="usage-energy-telemetry-val is-forge">
              <Sparkle size={13} weight="fill" />
              Forge Core
            </strong>
          </div>

          <div className="usage-energy-telemetry-item">
            <span className="usage-energy-telemetry-label">周边拓扑节点</span>
            <strong className="usage-energy-telemetry-val">
              {topology.providers.length} 供应商 · {topology.models.length} 模型
            </strong>
          </div>

          <div className="usage-energy-telemetry-item">
            <span className="usage-energy-telemetry-label">
              当前能量连接线 (含子代理)
            </span>
            <strong
              className="usage-energy-telemetry-val"
              data-testid="usage-energy-line-count"
            >
              {activeConduits.length} 条线条
              <span className="usage-energy-telemetry-sub">
                （主会话 {activeMainCount} · 子代理 {activeSubagentCount}）
              </span>
            </strong>
          </div>

          <div className="usage-energy-telemetry-item usage-energy-speed-item">
            <div className="usage-energy-speed-header">
              <span className="usage-energy-telemetry-label">能量传输速率</span>
              <strong
                className="usage-energy-telemetry-val is-speed"
                data-testid="usage-energy-speed-value"
              >
                {activeConduits.length > 0 ? `${transferSpeed}x` : "0x (待机)"}
              </strong>
            </div>
            <div
              className="usage-energy-speed-track"
              title={`当前 ${activeConduits.length} 个活跃会话通道，能量传输速率 ${transferSpeed}x（会话越多线条越多、传输越快）`}
            >
              <div
                className="usage-energy-speed-fill"
                style={{ width: `${speedMeterPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* 3D Stage + Interactive Channel List */}
        <div className="usage-3d-workbench-grid">
          <div className="usage-3d-canvas-Stage">
            <canvas
              ref={canvasRef}
              className="usage-3d-canvas"
              aria-label={`Forge 3D 能量网络画布：中心为 Forge，周边 ${topology.providers.length} 个模型供应商与 ${topology.models.length} 个模型，当前 ${activeConduits.length} 条会话能量线连接`}
              onPointerDown={(e) => {
                cameraRef.current.isDragging = true;
                cameraRef.current.lastX = e.clientX;
                cameraRef.current.lastY = e.clientY;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const localX = e.clientX - rect.left;
                const localY = e.clientY - rect.top;

                if (cameraRef.current.isDragging) {
                  const dx = e.clientX - cameraRef.current.lastX;
                  const dy = e.clientY - cameraRef.current.lastY;
                  cameraRef.current.yaw += dx * 0.0075;
                  cameraRef.current.pitch = Math.max(
                    -1.15,
                    Math.min(1.15, cameraRef.current.pitch + dy * 0.0075),
                  );
                  cameraRef.current.lastX = e.clientX;
                  cameraRef.current.lastY = e.clientY;
                  if (!hasActiveConduits) {
                    drawScene(performance.now(), false);
                  }
                  return;
                }

                const hit = hitNodesRef.current.find(
                  (n) => Math.hypot(localX - n.x, localY - n.y) <= n.r,
                );
                const nextLabel = hit ? hit.label : null;
                setHoveredNodeLabel((prev) =>
                  prev === nextLabel ? prev : nextLabel,
                );
              }}
              onPointerUp={(e) => {
                cameraRef.current.isDragging = false;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
              onPointerLeave={() => {
                cameraRef.current.isDragging = false;
                setHoveredNodeLabel(null);
              }}
            />

            {/* Floating Legend & Hover HUD inside 3D Stage */}
            <div className="usage-3d-stage-legend">
              <span className="usage-3d-legend-item">
                <span className="usage-3d-dot is-forge" />
                <span>Forge 核心</span>
              </span>
              <span className="usage-3d-legend-item">
                <span className="usage-3d-dot is-provider" />
                <span>模型供应商 ({topology.providers.length})</span>
              </span>
              <span className="usage-3d-legend-item">
                <span className="usage-3d-dot is-model" />
                <span>模型节点 ({topology.models.length})</span>
              </span>
              <span className="usage-3d-legend-item">
                <span className="usage-3d-dot is-session" />
                <span>主会话能量线 ({activeMainCount})</span>
              </span>
              <span className="usage-3d-legend-item">
                <span className="usage-3d-dot is-subagent" />
                <span>子代理能量线 ({activeSubagentCount})</span>
              </span>
            </div>

            <div className="usage-3d-stage-hint">
              {hoveredNodeLabel ? (
                <span className="usage-3d-hover-readout">
                  {hoveredNodeLabel}
                </span>
              ) : (
                <span>
                  拖拽画布可 360° 旋转 3D 拓扑 · 会话越多能量线越密集、传输越快
                </span>
              )}
            </div>
          </div>

          {/* Right-hand Topology & Energy Conduit Inspector */}
          <aside
            className="usage-3d-conduit-sidebar"
            aria-label="能量通道与周边节点明细"
          >
            <div className="usage-3d-sidebar-block">
              <div className="usage-3d-sidebar-head">
                <span>当前活跃能量通道 (会话 & 子代理)</span>
                <span className="usage-kpi-badge">
                  {activeConduits.length} 条
                </span>
              </div>

              {activeConduits.length === 0 ? (
                <div className="usage-3d-empty-conduits">
                  <p>
                    当前没有正在运行的会话或子代理；启动会话后将自动建立从对应模型通往
                    Forge 的 3D 能量传输线。
                  </p>
                </div>
              ) : (
                <div className="usage-3d-conduit-list">
                  {activeConduits.map((c) => {
                    const isSelected = selectedConduitId === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`usage-3d-conduit-row ${isSelected ? "is-selected" : ""} ${c.isSubagent ? "is-subagent" : ""}`}
                        onMouseEnter={() => setSelectedConduitId(c.id)}
                        onMouseLeave={() => setSelectedConduitId(null)}
                      >
                        <div className="usage-3d-conduit-main">
                          <span
                            className={`usage-3d-conduit-badge ${c.isSubagent ? "is-subagent" : "is-primary"}`}
                          >
                            {c.isSubagent ? (
                              <>
                                <GitBranch size={11} />
                                子代理
                              </>
                            ) : (
                              "主会话"
                            )}
                          </span>
                          <button
                            type="button"
                            className="usage-session-link usage-3d-conduit-title"
                            title={`打开会话：${c.title}`}
                            onClick={() => onSelectSession(c.sessionId)}
                          >
                            {c.title}
                          </button>
                          {c.isLiveRunning && (
                            <span className="usage-3d-live-pill">传输中</span>
                          )}
                        </div>
                        <div className="usage-3d-conduit-meta">
                          <span>{c.providerLabel}</span>
                          <span>→</span>
                          <span className="usage-mono">{c.modelLabel}</span>
                          <span>→</span>
                          <strong className="usage-3d-forge-target">
                            Forge
                          </strong>
                          {c.totalTokens > 0 && (
                            <span className="usage-mono usage-3d-conduit-tokens">
                              {compactTokens(c.totalTokens)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="usage-3d-sidebar-block">
              <div className="usage-3d-sidebar-head">
                <span>周边供应商与模型节点</span>
                <span className="usage-kpi-badge">
                  {topology.providers.length} 源 / {topology.models.length} 模型
                </span>
              </div>
              <div className="usage-3d-provider-list">
                {topology.providers.map((prov) => {
                  const childModels = topology.models.filter(
                    (m) => m.providerId === prov.id,
                  );
                  return (
                    <div key={prov.id} className="usage-3d-provider-group">
                      <div className="usage-3d-provider-row">
                        <strong>{prov.label}</strong>
                        <span className="usage-mono">
                          {prov.activeSessionCount} 通道 ·{" "}
                          {compactTokens(prov.totalTokens)}
                        </span>
                      </div>
                      <div className="usage-3d-model-chips">
                        {childModels.map((m) => (
                          <span
                            key={m.id}
                            className={`usage-3d-model-chip ${m.activeSessionCount > 0 ? "is-energized" : ""}`}
                            title={`${m.modelId} · ${m.activeSessionCount} 条能量连接 · ${compactTokens(m.totalTokens)} tokens`}
                          >
                            <span>{m.label}</span>
                            {m.activeSessionCount > 0 && (
                              <strong className="usage-3d-chip-count">
                                ×{m.activeSessionCount}
                              </strong>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

export function renderUsageKpiGrid({
  data,
  costSummary,
  requestAnalytics,
  requestsCount,
  aggregateCostExplanation,
  formatCostUsd,
  formatDuration,
  percent,
  shortModelName,
}: {
  readonly data: UsageStatsDto;
  readonly costSummary: {
    readonly totalCostUsd: number | undefined;
    readonly hasAggregateEstimate: boolean;
    readonly incomplete: boolean;
  };
  readonly requestAnalytics: {
    readonly pricedCount: number;
    readonly avgSpeed: number | undefined;
    readonly peakSpeed: number | undefined;
    readonly avgDurationMs: number | undefined;
  };
  readonly requestsCount: number;
  readonly aggregateCostExplanation: string;
  readonly formatCostUsd: (value: number | undefined) => string;
  readonly formatDuration: (value: number | undefined) => string;
  readonly percent: (value: number) => string;
  readonly shortModelName: (model: string) => string;
}) {
  return (
    <div className="usage-kpi-grid">
      <div className="usage-kpi-card">
        <div className="usage-kpi-label">
          <span>总消耗 Tokens</span>
          <Lightning size={14} />
        </div>
        <div className="usage-kpi-value">{compactTokens(data.totalTokens)}</div>
        <div className="usage-kpi-sub">
          <span>入 {compactTokens(data.totalPromptTokens)}</span>
          <span>·</span>
          <span>出 {compactTokens(data.totalCompletionTokens)}</span>
        </div>
      </div>

      <div className="usage-kpi-card">
        <div className="usage-kpi-label">
          <span>平均缓存命中率</span>
          <Database size={14} />
        </div>
        <div className="usage-kpi-value">{percent(data.averageCacheRate)}</div>
        <div className="usage-kpi-sub">
          <span>命中 {compactTokens(data.totalCachedTokens)} tokens</span>
        </div>
      </div>

      <div className="usage-kpi-card">
        <div className="usage-kpi-label">
          <span>预估总费用 (USD)</span>
          <ChartBar size={14} />
        </div>
        <div className="usage-kpi-value">
          {formatCostUsd(costSummary.totalCostUsd)}
        </div>
        <div
          className="usage-kpi-sub"
          title={
            costSummary.hasAggregateEstimate
              ? aggregateCostExplanation
              : undefined
          }
        >
          {costSummary.totalCostUsd !== undefined ? (
            <span>
              {costSummary.incomplete ? "部分计价" : "已计价"}
              {requestsCount > 0 &&
                ` ${requestAnalytics.pricedCount} / ${requestsCount} 次请求`}
              {costSummary.hasAggregateEstimate && " · 含历史汇总估算"}
            </span>
          ) : (
            <span>
              {data.pricing?.state === "unavailable"
                ? "价格目录加载失败，点击刷新重试"
                : "缺少价格或用量，费用未知"}
            </span>
          )}
        </div>
      </div>

      <div className="usage-kpi-card">
        <div className="usage-kpi-label">
          <span>平均输出速度</span>
          <Lightning size={14} />
        </div>
        <div className="usage-kpi-value">
          {requestAnalytics.avgSpeed !== undefined
            ? `${requestAnalytics.avgSpeed.toFixed(1)}`
            : "—"}
          {requestAnalytics.avgSpeed !== undefined && (
            <span className="usage-kpi-unit">tok/s</span>
          )}
        </div>
        <div className="usage-kpi-sub">
          <span>
            峰值{" "}
            {requestAnalytics.peakSpeed !== undefined
              ? `${requestAnalytics.peakSpeed.toFixed(1)} tok/s`
              : "—"}
          </span>
          <span>·</span>
          <span>均耗时 {formatDuration(requestAnalytics.avgDurationMs)}</span>
        </div>
      </div>

      <div className="usage-kpi-card">
        <div className="usage-kpi-label">
          <span>会话与运行总数</span>
          <Calendar size={14} />
        </div>
        <div className="usage-kpi-value">
          {data.totalSessions} <span className="usage-kpi-unit">会话</span>
        </div>
        <div className="usage-kpi-sub">
          <span>累计运行 {data.totalRuns} 次任务</span>
          {requestsCount > 0 && (
            <>
              <span>·</span>
              <span>{requestsCount} 请求</span>
            </>
          )}
        </div>
      </div>

      <div className="usage-kpi-card">
        <div className="usage-kpi-label">
          <span>主力模型</span>
          <Cpu size={14} />
        </div>
        <div
          className="usage-kpi-value usage-kpi-model-value"
          title={data.models[0]?.model || "暂无模型"}
        >
          {data.models[0]?.model ? shortModelName(data.models[0].model) : "—"}
        </div>
        <div className="usage-kpi-sub">
          <span>共 {data.models.length} 个使用中的模型</span>
        </div>
      </div>
    </div>
  );
}
