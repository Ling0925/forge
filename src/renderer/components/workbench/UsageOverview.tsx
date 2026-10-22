import {
  ArrowsClockwise,
  Calendar,
  ChartBar,
  Cpu,
  Database,
  GitBranch,
  GlobeHemisphereWest,
  Lightning,
  Pause,
  Play,
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
  readonly allConduits: readonly SessionEnergyConduit[];
  readonly liveConduits: readonly SessionEnergyConduit[];
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
      resolveProviderAndModel(req.model, req.sourceId);
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

  // 4. Collect all current sessions (including sub-agents)
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
    hasStartedRequest: boolean;
  }

  const sessionMap = new Map<string, MergedSession>();

  // From state.sessions (includes both primary sessions and sub-agents with parentSessionId)
  for (const s of sessions) {
    if (!s || typeof s.id !== "string" || !s.id) continue;
    if (s.archived) continue;
    if (workspaceFilter && s.workspace !== workspaceFilter) continue;
    const activeRun = activeRuns[s.id];
    const effectiveStatus: SessionStatus =
      activeRun?.status ?? s.status ?? "idle";
    sessionMap.set(s.id, {
      sessionId: s.id,
      title: s.title || (s.parentSessionId ? "子代理任务" : "未命名会话"),
      workspace: s.workspace || "",
      model: s.model || settings?.model || "default-model",
      providerSourceId: s.providerSourceId,
      parentSessionId: s.parentSessionId,
      isSubagent: Boolean(s.parentSessionId),
      status: effectiveStatus,
      totalTokens: 0,
      hasStartedRequest: false,
    });
  }

  // Enrich or add from data.topSessions
  for (const ts of data.topSessions) {
    if (workspaceFilter && ts.workspace !== workspaceFilter) continue;
    const existing = sessionMap.get(ts.sessionId);
    if (existing) {
      existing.totalTokens = Math.max(existing.totalTokens, ts.totalTokens);
      if (!existing.model || existing.model === "default-model") {
        existing.model = ts.model;
      }
    } else {
      const activeRun = activeRuns[ts.sessionId];
      sessionMap.set(ts.sessionId, {
        sessionId: ts.sessionId,
        title: ts.title || "会话",
        workspace: ts.workspace,
        model: ts.model || settings?.model || "default-model",
        isSubagent: false,
        status: activeRun?.status ?? "completed",
        totalTokens: ts.totalTokens,
        hasStartedRequest: false,
      });
    }
  }

  // Enrich or add from data.requests
  for (const req of data.requests ?? []) {
    if (workspaceFilter && req.workspace !== workspaceFilter) continue;
    const existing = sessionMap.get(req.sessionId);
    const isStarted = req.outcome === "started" || req.outcome === "unknown";
    if (existing) {
      if (!existing.providerSourceId && req.sourceId) {
        existing.providerSourceId = req.sourceId;
      }
      if (!existing.model || existing.model === "default-model") {
        existing.model = req.model;
      }
      if (isStarted) existing.hasStartedRequest = true;
      if (req.usage?.totalTokens) {
        existing.totalTokens += req.usage.totalTokens;
      }
    } else {
      const activeRun = activeRuns[req.sessionId];
      sessionMap.set(req.sessionId, {
        sessionId: req.sessionId,
        title: req.sessionTitle || "会话",
        workspace: req.workspace,
        model: req.model || settings?.model || "default-model",
        providerSourceId: req.sourceId,
        isSubagent: false,
        status: activeRun?.status ?? (isStarted ? "running" : "completed"),
        totalTokens: req.usage?.totalTokens ?? 0,
        hasStartedRequest: isStarted,
      });
    }
  }

  // Also include any activeRuns not yet in sessionMap
  for (const [sid, run] of Object.entries(activeRuns)) {
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        sessionId: run.sessionId,
        title: "实时运行会话",
        workspace: workspaceFilter ?? "",
        model: settings?.model || "default-model",
        providerSourceId: settings?.activeSourceId,
        isSubagent: false,
        status: run.status,
        totalTokens: 0,
        hasStartedRequest: true,
      });
    }
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
    const isLiveRunning =
      s.status === "running" ||
      s.status === "awaiting_approval" ||
      s.hasStartedRequest;

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
      isLiveRunning,
    });
  }

  // Ensure every provider has at least one model node so the 3D periphery is complete
  for (const src of sourceById.values()) {
    if (src.models.size === 0) {
      src.models.add(settings?.model?.trim() || "未配置模型");
    }
  }

  // 5. Compute 3D positions for Providers (inner 3D orbital ring) and Models (outer 3D orbital shell)
  const providerList = Array.from(sourceById.values());
  const providerCount = providerList.length;
  const providerRadius = providerCount === 1 ? 135 : 155;
  const modelRadius = 258;

  const providers3D: ProviderNode3D[] = [];
  const models3D: ModelNode3D[] = [];

  providerList.forEach((prov, pIdx) => {
    const baseAngle =
      (pIdx / Math.max(providerCount, 1)) * Math.PI * 2 - Math.PI / 2;
    const provY = providerCount > 1 ? Math.sin(baseAngle * 2 + 0.6) * 32 : 0;
    const provX = Math.cos(baseAngle) * providerRadius;
    const provZ = Math.sin(baseAngle) * providerRadius;

    const modelKeys = Array.from(prov.models);
    const sectorSpan =
      providerCount === 1
        ? Math.PI * 1.65
        : Math.min(
            ((Math.PI * 2) / providerCount) * 0.78,
            Math.max(0.45, modelKeys.length * 0.36),
          );

    let providerTokens = 0;
    const childModelNodeIds: string[] = [];

    modelKeys.forEach((mKey, mIdx) => {
      const canonicalId = `${prov.id}::${mKey}`;
      childModelNodeIds.push(canonicalId);
      const mStat = modelStatsMap.get(canonicalId);
      const tokens = mStat?.totalTokens ?? 0;
      const runs = mStat?.runCount ?? 0;
      providerTokens += tokens;

      const offsetRatio =
        modelKeys.length === 1 ? 0 : mIdx / (modelKeys.length - 1) - 0.5;
      const mAngle = baseAngle + offsetRatio * sectorSpan;
      // Give models a 3D spherical vertical distribution around their provider plane
      const elevationWave =
        Math.cos(mIdx * 1.7 + pIdx * 1.1) * 48 + (mIdx % 2 === 0 ? 18 : -18);
      const radialJitter = mIdx % 3 === 0 ? 0 : mIdx % 3 === 1 ? 16 : -12;
      const r = modelRadius + radialJitter;

      const mx = Math.cos(mAngle) * r;
      const mz = Math.sin(mAngle) * r;
      const my = provY * 0.7 + elevationWave;

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

  // Group conduits by modelNodeId so multiple sessions on the same model fan out cleanly in 3D
  const byModel = new Map<string, RawConduit[]>();
  for (const rc of rawConduits) {
    const group = byModel.get(rc.modelNodeId) ?? [];
    group.push(rc);
    byModel.set(rc.modelNodeId, group);
  }

  const allConduits: SessionEnergyConduit[] = [];
  let conduitIdx = 0;
  for (const group of byModel.values()) {
    group.forEach((rc, siblingIndex) => {
      allConduits.push({
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

  const liveConduits = allConduits.filter((c) => c.isLiveRunning);
  const subagentSessionCount = allConduits.filter((c) => c.isSubagent).length;
  const mainSessionCount = allConduits.length - subagentSessionCount;

  return {
    providers: providers3D,
    models: models3D,
    allConduits,
    liveConduits,
    mainSessionCount,
    subagentSessionCount,
    liveRunningCount: liveConduits.length,
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

function rotateZ(p: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
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
 * Computes a unique 3D control point for a session conduit between a Model node and Forge (0,0,0),
 * so multiple sessions on the same model fan out in 3D space.
 */
function conduitControlPoint(
  modelPos: Vec3,
  siblingIndex: number,
  siblingCount: number,
  conduitIndex: number,
): Vec3 {
  const midX = modelPos[0] * 0.5;
  const midY = modelPos[1] * 0.5;
  const midZ = modelPos[2] * 0.5;

  // Tangent perpendicular in XZ plane
  const lenXZ = Math.hypot(modelPos[0], modelPos[2]) || 1;
  const perpX = -modelPos[2] / lenXZ;
  const perpZ = modelPos[0] / lenXZ;

  const spreadIndex =
    siblingCount <= 1 ? 0 : siblingIndex - (siblingCount - 1) / 2;
  const lateralSpread = spreadIndex * 42;
  const verticalArch =
    (conduitIndex % 2 === 0 ? 1 : -1) * (36 + Math.abs(spreadIndex) * 22);

  return [
    midX + perpX * lateralSpread,
    midY - verticalArch,
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
  const topology = useMemo(
    () =>
      buildEnergyNetworkTopology(
        data,
        settings,
        sessions,
        activeRuns,
        workspaceFilter,
      ),
    [data, settings, sessions, activeRuns, workspaceFilter],
  );

  const [conduitScope, setConduitScope] = useState<"all" | "live">("all");
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedConduitId, setSelectedConduitId] = useState<string | null>(
    null,
  );
  const [hoveredNodeLabel, setHoveredNodeLabel] = useState<string | null>(null);

  const activeConduits =
    conduitScope === "live" ? topology.liveConduits : topology.allConduits;
  const activeSubagentCount = activeConduits.filter((c) => c.isSubagent).length;
  const activeMainCount = activeConduits.length - activeSubagentCount;
  const activeLiveCount = activeConduits.filter((c) => c.isLiveRunning).length;

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
  const cameraRef = useRef({
    yaw: 0.35,
    pitch: 0.38,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    energyPhase: 0,
    corePhase: 0,
  });

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

  const resetCamera = useCallback(() => {
    cameraRef.current.yaw = 0.35;
    cameraRef.current.pitch = 0.38;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let animationFrameId = 0;
    let lastTime = performance.now();

    const modelById = new Map<string, ModelNode3D>();
    for (const m of topology.models) {
      modelById.set(m.id, m);
    }
    const providerById = new Map<string, ProviderNode3D>();
    for (const p of topology.providers) {
      providerById.set(p.id, p);
    }

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(rect.width, 300);
      const height = Math.max(rect.height, 360);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
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
      const tetherStroke = isDark
        ? "rgba(170, 167, 159, 0.26)"
        : "rgba(104, 102, 95, 0.25)";
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
      const modelFill = isDark ? "#25292e" : "#e8eef5";
      const modelStroke = isDark ? "#6ca6d9" : "#3b6998";
      const mainConduitColor = isDark ? "#dc9477" : "#a54f35";
      const subagentConduitColor = isDark ? "#56b881" : "#226d40";

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

      // Update camera & animation phases
      const cam = cameraRef.current;
      if (!reducedMotion) {
        if (autoRotate && !cam.isDragging) {
          const baseSpin = 0.16 + Math.min(transferSpeed * 0.04, 0.22);
          cam.yaw += dt * baseSpin;
        }
        // Energy flow speed scales directly with session count / transferSpeed
        const flowRate =
          activeConduits.length > 0 ? 0.28 * transferSpeed : 0.08;
        cam.energyPhase = (cam.energyPhase + dt * flowRate) % 1000;
        cam.corePhase =
          (cam.corePhase + dt * (0.6 + transferSpeed * 0.55)) % (Math.PI * 20);
      }

      const cx = width * 0.5;
      const cy = height * 0.52;
      const fov = 640;
      const minDim = Math.min(width, height);
      const sceneScale = Math.max(0.54, Math.min(1.08, minDim / 610));

      // Draw 3D orbital reference rings (Provider inner orbit & Model outer orbit)
      for (const orbitRadius of [155, 258]) {
        ctx.beginPath();
        const segments = 72;
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

      // Draw Provider -> Model 3D structural tethers
      for (const mNode of topology.models) {
        const pNode = providerById.get(mNode.providerId);
        if (!pNode) continue;
        const pRot = transformPoint(pNode.pos, cam.yaw, cam.pitch);
        const mRot = transformPoint(mNode.pos, cam.yaw, cam.pitch);
        const pProj = projectPoint(pRot, cx, cy, fov, sceneScale);
        const mProj = projectPoint(mRot, cx, cy, fov, sceneScale);

        const isActiveLink = mNode.activeSessionCount > 0;
        ctx.beginPath();
        ctx.moveTo(pProj.x, pProj.y);
        ctx.lineTo(mProj.x, mProj.y);
        ctx.strokeStyle = isActiveLink ? activeTetherStroke : tetherStroke;
        ctx.lineWidth = isActiveLink ? 1.6 : 1;
        ctx.stroke();

        // If sessions are active on this model, show a feeder pulse from Provider -> Model
        if (isActiveLink) {
          const feederT = (cam.energyPhase * 1.3) % 1;
          const fx = pProj.x + (mProj.x - pProj.x) * feederT;
          const fy = pProj.y + (mProj.y - pProj.y) * feederT;
          ctx.beginPath();
          ctx.arc(fx, fy, 2.6 * mProj.scale, 0, Math.PI * 2);
          ctx.fillStyle = providerStroke;
          ctx.fill();
        }
      }

      // Draw Session Energy Conduits (Model -> Forge Core (0,0,0))
      const forgeCenter3D: Vec3 = [0, 0, 0];
      const forgeCenterProj = projectPoint(
        forgeCenter3D,
        cx,
        cy,
        fov,
        sceneScale,
      );

      activeConduits.forEach((conduit, cIdx) => {
        const mNode = modelById.get(conduit.modelNodeId);
        if (!mNode) return;

        const cp3D = conduitControlPoint(
          mNode.pos,
          conduit.siblingIndex,
          conduit.siblingCount,
          cIdx,
        );

        const isSelected = selectedConduitId === conduit.id;
        const baseColor = conduit.isSubagent
          ? subagentConduitColor
          : mainConduitColor;

        // Sample 3D curve points from Model -> Forge
        const steps = 28;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const pt3D = quadraticBezier3D(mNode.pos, cp3D, forgeCenter3D, t);
          const rot = transformPoint(pt3D, cam.yaw, cam.pitch);
          const proj = projectPoint(rot, cx, cy, fov, sceneScale);
          if (s === 0) ctx.moveTo(proj.x, proj.y);
          else ctx.lineTo(proj.x, proj.y);
        }

        ctx.strokeStyle = baseColor;
        ctx.globalAlpha = isSelected
          ? 0.95
          : conduit.isLiveRunning
            ? 0.78
            : 0.52;
        ctx.lineWidth = isSelected ? 2.8 : conduit.isLiveRunning ? 2.1 : 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Energy particles traveling from Model (t=0) -> Forge Core (t=1)
        const particleCount = Math.min(
          6,
          2 +
            Math.floor(activeConduits.length / 2) +
            (conduit.isLiveRunning ? 1 : 0),
        );
        for (let p = 0; p < particleCount; p++) {
          const rawT =
            (cam.energyPhase + conduit.phaseOffset + p / particleCount) % 1;
          const t = rawT < 0 ? rawT + 1 : rawT;
          const head3D = quadraticBezier3D(mNode.pos, cp3D, forgeCenter3D, t);
          const headRot = transformPoint(head3D, cam.yaw, cam.pitch);
          const headProj = projectPoint(headRot, cx, cy, fov, sceneScale);

          // Comet tail
          const tailT = Math.max(0, t - 0.065);
          const tail3D = quadraticBezier3D(
            mNode.pos,
            cp3D,
            forgeCenter3D,
            tailT,
          );
          const tailRot = transformPoint(tail3D, cam.yaw, cam.pitch);
          const tailProj = projectPoint(tailRot, cx, cy, fov, sceneScale);

          const grad = ctx.createLinearGradient(
            tailProj.x,
            tailProj.y,
            headProj.x,
            headProj.y,
          );
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(1, baseColor);
          ctx.beginPath();
          ctx.moveTo(tailProj.x, tailProj.y);
          ctx.lineTo(headProj.x, headProj.y);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3.2 * headProj.scale;
          ctx.stroke();

          // Glowing particle head
          const radius = (conduit.isLiveRunning ? 4.2 : 3.3) * headProj.scale;
          ctx.beginPath();
          ctx.arc(headProj.x, headProj.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = baseColor;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(headProj.x, headProj.y, radius * 0.48, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
        }
      });

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

      for (const pNode of topology.providers) {
        const rot = transformPoint(pNode.pos, cam.yaw, cam.pitch);
        const proj = projectPoint(rot, cx, cy, fov, sceneScale);
        renderQueue.push({ kind: "provider", z: rot[2], proj, node: pNode });
      }

      for (const mNode of topology.models) {
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
          const coreR = 30 * scale;
          const pulseBoost =
            activeConduits.length > 0
              ? 1 +
                Math.sin(cam.corePhase * 2) *
                  0.08 *
                  Math.min(transferSpeed, 2.5)
              : 1;

          // Outer aura glow
          const auraR = coreR * 2.5 * pulseBoost;
          const aura = ctx.createRadialGradient(x, y, coreR * 0.2, x, y, auraR);
          aura.addColorStop(0, forgeCoreGlow);
          aura.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(x, y, auraR, 0, Math.PI * 2);
          ctx.fillStyle = aura;
          ctx.fill();

          // 3D Gyroscope rings around Forge
          const gimbalConfigs: ReadonlyArray<{
            rx: number;
            ry: number;
            rz: number;
            radius: number;
            color: string;
          }> = [
            {
              rx: cam.corePhase * 0.7,
              ry: cam.yaw,
              rz: 0.4,
              radius: 44,
              color: forgeCoreMain,
            },
            {
              rx: -0.6,
              ry: -cam.corePhase * 0.9,
              rz: cam.corePhase * 0.5,
              radius: 54,
              color: providerStroke,
            },
            {
              rx: 0.9,
              ry: cam.corePhase * 0.6,
              rz: -cam.corePhase * 0.8,
              radius: 64,
              color: modelStroke,
            },
          ];

          for (const g of gimbalConfigs) {
            ctx.beginPath();
            const segs = 40;
            for (let i = 0; i <= segs; i++) {
              const a = (i / segs) * Math.PI * 2;
              let pt: Vec3 = [
                Math.cos(a) * g.radius,
                Math.sin(a) * g.radius,
                0,
              ];
              pt = rotateX(pt, g.rx);
              pt = rotateY(pt, g.ry);
              pt = rotateZ(pt, g.rz);
              const gp = projectPoint(pt, cx, cy, fov, sceneScale);
              if (i === 0) ctx.moveTo(gp.x, gp.y);
              else ctx.lineTo(gp.x, gp.y);
            }
            ctx.strokeStyle = g.color;
            ctx.globalAlpha = activeConduits.length > 0 ? 0.58 : 0.3;
            ctx.lineWidth = 1.4;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

          // 3D Octahedron wireframe inside the Forge Core
          const octR = 24;
          const octVertices: Vec3[] = [
            [0, octR, 0],
            [0, -octR, 0],
            [octR, 0, 0],
            [-octR, 0, 0],
            [0, 0, octR],
            [0, 0, -octR],
          ];
          const octEdges: ReadonlyArray<readonly [number, number]> = [
            [0, 2],
            [0, 3],
            [0, 4],
            [0, 5],
            [1, 2],
            [1, 3],
            [1, 4],
            [1, 5],
            [2, 4],
            [4, 3],
            [3, 5],
            [5, 2],
          ];
          const projectedVerts = octVertices.map((v) => {
            const r1 = rotateY(v, cam.corePhase * 0.8 + cam.yaw);
            const r2 = rotateX(r1, cam.pitch + cam.corePhase * 0.4);
            return projectPoint(r2, cx, cy, fov, sceneScale);
          });

          ctx.beginPath();
          for (const [u, w] of octEdges) {
            const pu = projectedVerts[u];
            const pw = projectedVerts[w];
            if (pu && pw) {
              ctx.moveTo(pu.x, pu.y);
              ctx.lineTo(pw.x, pw.y);
            }
          }
          ctx.strokeStyle = forgeCoreMain;
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;

          // Inner solid energy sphere
          ctx.beginPath();
          ctx.arc(x, y, coreR * 0.56 * pulseBoost, 0, Math.PI * 2);
          ctx.fillStyle = forgeCoreMain;
          ctx.fill();

          // Label "FORGE"
          ctx.font = `700 ${Math.round(13 * scale)}px var(--font-sans, sans-serif)`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = textPrimary;
          ctx.fillText("FORGE", x, y + coreR + 14 * scale);

          const rateSub =
            activeConduits.length > 0
              ? `${activeConduits.length} 通道 · ${transferSpeed}x`
              : "待机轨道";
          ctx.font = `500 ${Math.round(10 * scale)}px var(--font-mono, monospace)`;
          ctx.fillStyle = textSecondary;
          ctx.fillText(rateSub, x, y + coreR + 28 * scale);

          newHitNodes.push({
            x,
            y,
            r: coreR * 1.2,
            label: `Forge 核心 · ${activeConduits.length} 条会话能量线 (${activeMainCount} 主会话 / ${activeSubagentCount} 子代理) · 传输速率 ${transferSpeed}x`,
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
          ctx.font = `600 ${Math.max(10, Math.round(11 * scale))}px var(--font-sans, sans-serif)`;
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
            ctx.font = `700 ${Math.max(8, Math.round(9 * scale))}px var(--font-mono, monospace)`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = textPrimary;
            ctx.fillText(String(mNode.activeSessionCount), x, y);
          }

          // Model short name
          ctx.font = `500 ${Math.max(9, Math.round(10.5 * scale))}px var(--font-mono, monospace)`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = hasActive ? textPrimary : textSecondary;
          ctx.fillText(mNode.label, x, y + r + 4 * scale);

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

      if (!reducedMotion) {
        animationFrameId = window.requestAnimationFrame(renderFrame);
      }
    };

    // Draw initial frame synchronously so tests & screenshots immediately have content
    renderFrame(performance.now());
    if (!reducedMotion) {
      animationFrameId = window.requestAnimationFrame(renderFrame);
    }

    return () => {
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    topology,
    activeConduits,
    activeMainCount,
    activeSubagentCount,
    transferSpeed,
    autoRotate,
    selectedConduitId,
  ]);

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
              {topology.models.length} 个模型 · 会话与子代理实时能量汇聚
            </span>
          </div>

          <div className="usage-section-header-right">
            <div className="usage-mode-switch">
              <button
                type="button"
                className={`usage-mode-btn ${conduitScope === "all" ? "is-active" : ""}`}
                aria-pressed={conduitScope === "all"}
                onClick={() => setConduitScope("all")}
              >
                全部会话 ({topology.allConduits.length})
              </button>
              <button
                type="button"
                className={`usage-mode-btn ${conduitScope === "live" ? "is-active" : ""}`}
                aria-pressed={conduitScope === "live"}
                onClick={() => setConduitScope("live")}
              >
                仅运行中 ({topology.liveConduits.length})
              </button>
            </div>

            <div className="usage-3d-camera-actions">
              <button
                type="button"
                className="usage-dashboard-btn"
                onClick={() => setAutoRotate((v) => !v)}
                aria-pressed={autoRotate}
                title={autoRotate ? "暂停 3D 自动旋转" : "开启 3D 自动旋转"}
              >
                {autoRotate ? <Pause size={13} /> : <Play size={13} />}
                <span>{autoRotate ? "旋转中" : "已暂停"}</span>
              </button>
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
              能量连接线 (含子代理)
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
              title={`当前 ${activeConduits.length} 个会话通道，能量传输速率 ${transferSpeed}x（会话越多线条越多、传输越快）`}
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
                  return;
                }

                const hit = hitNodesRef.current.find(
                  (n) => Math.hypot(localX - n.x, localY - n.y) <= n.r,
                );
                setHoveredNodeLabel(hit ? hit.label : null);
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
                <span>活跃能量通道 (会话 & 子代理)</span>
                <span className="usage-kpi-badge">
                  {activeConduits.length} 条
                </span>
              </div>

              {activeConduits.length === 0 ? (
                <div className="usage-3d-empty-conduits">
                  <p>
                    {conduitScope === "live"
                      ? "当前没有正在执行的实时会话；可切换至「全部会话」查看所有已连接会话通道。"
                      : "当前暂无会话连接，启动主会话或子代理后将自动建立通往 Forge 的 3D 能量传输线。"}
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
