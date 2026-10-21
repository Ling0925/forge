import type { Message } from "../../../shared/schemas";

export interface MemoryRefItem {
  readonly text: string;
  readonly refs: readonly string[];
  readonly truncated?: boolean | undefined;
}

export interface MemorySectionGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly MemoryRefItem[];
}

export interface MemoryExcerptBlock {
  readonly ref?: string | undefined;
  readonly roleLabel?: string | undefined;
  readonly text: string;
  readonly rawText?: string | undefined;
  readonly truncated?: boolean | undefined;
}

export interface MemoryPlanSummary {
  readonly title?: string | undefined;
  readonly explanation?: string | undefined;
  readonly steps: readonly {
    readonly step: string;
    readonly status: string;
  }[];
  readonly truncated?: boolean | undefined;
}

export type ParsedContextMemory =
  | {
      readonly kind: "working_state";
      readonly archiveRange?: string | undefined;
      readonly goal: string;
      readonly sections: readonly MemorySectionGroup[];
      readonly truncated?: boolean | undefined;
    }
  | {
      readonly kind: "run_checkpoint";
      readonly archiveRange?: string | undefined;
      readonly statusLabel: string;
      readonly endedAt?: string | undefined;
      readonly effectsMayBeUncertain: boolean;
      readonly initialRequest?: MemoryExcerptBlock | undefined;
      readonly latestRequest?: MemoryExcerptBlock | undefined;
      readonly latestAssistantReport?: MemoryExcerptBlock | undefined;
      readonly plan?: MemoryPlanSummary | undefined;
      readonly priorMemory?: ParsedContextMemory | undefined;
      readonly priorMemoryTruncated?: boolean | undefined;
      readonly toolObservations: readonly MemoryExcerptBlock[];
    }
  | {
      readonly kind: "fallback_state";
      readonly archiveRange?: string | undefined;
      readonly unsummarizedRanges?: string | undefined;
      readonly previousState?: ParsedContextMemory | undefined;
      readonly previousStateTruncated?: boolean | undefined;
      readonly plan?: MemoryPlanSummary | undefined;
      readonly excerpts: readonly MemoryExcerptBlock[];
    }
  | {
      readonly kind: "structured_json";
      readonly archiveRange?: string | undefined;
      readonly entries: readonly {
        readonly key: string;
        readonly label: string;
        readonly value: string;
      }[];
    }
  | {
      readonly kind: "markdown";
      readonly archiveRange?: string | undefined;
      readonly text: string;
    };

const WORKING_STATE_SECTIONS: readonly {
  readonly key:
    | "completed"
    | "nextSteps"
    | "decisions"
    | "constraints"
    | "verification"
    | "uncertainties";
  readonly label: string;
}[] = [
  { key: "completed", label: "已完成" },
  { key: "nextSteps", label: "下一步" },
  { key: "decisions", label: "关键决策" },
  { key: "constraints", label: "约束条件" },
  { key: "verification", label: "验证情况" },
  { key: "uncertainties", label: "待确认项" },
];

const STATUS_LABELS: Record<string, string> = {
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  running: "运行中",
  awaiting_approval: "待批准",
  idle: "空闲",
};

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  system: "系统",
};

const GENERIC_KEY_LABELS: Record<string, string> = {
  goal: "任务目标",
  status: "状态",
  endedAt: "结束时间",
  boundary: "边界",
  summary: "摘要",
  explanation: "说明",
  title: "标题",
  constraints: "约束条件",
  decisions: "关键决策",
  completed: "已完成",
  nextSteps: "下一步",
  verification: "验证情况",
  uncertainties: "待确认项",
};

function unescapeJsonStringFragment(fragment: string): string {
  return fragment
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function formatReadableToolEnvelope(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return trimmed;
    }
    const obj = parsed as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof obj.command === "string" && obj.command.trim()) {
      parts.push(`$ ${obj.command.trim()}`);
    } else if (Array.isArray(obj.command) && obj.command.length > 0) {
      parts.push(`$ ${obj.command.map(String).join(" ")}`);
    }
    if (typeof obj.path === "string" && obj.path.trim()) {
      parts.push(`路径：${obj.path.trim()}`);
    }
    if (typeof obj.summary === "string" && obj.summary.trim()) {
      parts.push(obj.summary.trim());
    }
    if (typeof obj.error === "string" && obj.error.trim()) {
      parts.push(`错误：${obj.error.trim()}`);
    }
    if (typeof obj.content === "string" && obj.content.trim()) {
      parts.push(obj.content.trim());
    }
    if (typeof obj.stdout === "string" && obj.stdout.trim()) {
      parts.push(obj.stdout.trim());
    }
    if (typeof obj.stderr === "string" && obj.stderr.trim()) {
      parts.push(`标准错误：${obj.stderr.trim()}`);
    }
    if (typeof obj.output === "string" && obj.output.trim()) {
      parts.push(obj.output.trim());
    }
    if (typeof obj.exit_code === "number" && obj.exit_code !== 0) {
      parts.push(`退出码：${obj.exit_code}`);
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("\n");
  } catch {
    const parts: string[] = [];
    const cmdMatch = trimmed.match(/"command":"((?:\\.|[^"\\])*)/);
    if (cmdMatch?.[1]) {
      parts.push(`$ ${unescapeJsonStringFragment(cmdMatch[1]).trim()}`);
    }
    const pathMatch = trimmed.match(/"path":"((?:\\.|[^"\\])*)/);
    if (pathMatch?.[1]) {
      parts.push(`路径：${unescapeJsonStringFragment(pathMatch[1]).trim()}`);
    }
    const contentMatch = trimmed.match(
      /"(?:stdout|content|output|error|summary)":"((?:\\.|[^"\\])*)/,
    );
    if (contentMatch?.[1]) {
      parts.push(unescapeJsonStringFragment(contentMatch[1]).trim());
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  return trimmed;
}

export function extractReadableMessageFromRecord(message: Message): {
  readonly roleLabel: string;
  readonly text: string;
} {
  const roleLabel = ROLE_LABELS[message.role] ?? message.role;
  const parts: string[] = [];
  if (message.content && message.content.trim()) {
    const body =
      message.role === "tool"
        ? formatReadableToolEnvelope(message.content)
        : message.content.trim();
    if (body) parts.push(body);
  }
  if (
    message.role === "assistant" &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  ) {
    const calls = message.tool_calls
      .map((call) => {
        const name = call.function?.name ?? "tool";
        const args = call.function?.arguments?.trim();
        return args ? `${name}(${args})` : name;
      })
      .join("、");
    parts.push(`调用工具：${calls}`);
  }
  return {
    roleLabel,
    text: parts.join("\n\n") || "（空记录）",
  };
}

export function resolveMessageByRef(
  messages: readonly Message[] | undefined,
  ref: string | undefined,
  messageOffset = 0,
): { readonly roleLabel: string; readonly text: string } | undefined {
  if (!messages || !ref) return undefined;
  const match = ref.match(/^m([1-9]\d*)$/);
  if (!match?.[1]) return undefined;
  const index = Number(match[1]) - 1 - messageOffset;
  const message = messages[index];
  if (!message) return undefined;
  return extractReadableMessageFromRecord(message);
}

export function extractReadableMessageText(
  raw: string,
): { readonly roleLabel?: string | undefined; readonly text: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { text: "" };

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const role =
          typeof record.role === "string"
            ? ROLE_LABELS[record.role] ?? record.role
            : undefined;
        if (typeof record.excerpt === "string") {
          const inner = extractReadableMessageText(record.excerpt);
          return {
            roleLabel: inner.roleLabel ?? role,
            text: inner.text,
          };
        }
        if (typeof record.content === "string" && record.content.trim()) {
          const cleaned =
            record.role === "tool"
              ? formatReadableToolEnvelope(record.content)
              : record.content.trim();
          return { roleLabel: role, text: cleaned };
        }
        if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
          const names = record.tool_calls
            .map((call) => {
              if (typeof call === "object" && call !== null && "function" in call) {
                const fn = (call as { function?: { name?: unknown } }).function;
                return typeof fn?.name === "string" ? fn.name : null;
              }
              return null;
            })
            .filter((name): name is string => Boolean(name));
          if (names.length > 0) {
            return { roleLabel: role, text: `调用工具：${names.join("、")}` };
          }
        }
        return {
          roleLabel: role,
          text: formatReadableToolEnvelope(trimmed),
        };
      }
    } catch {
      const roleMatch = trimmed.match(/"role":"([^"]+)"/);
      const role = roleMatch?.[1]
        ? ROLE_LABELS[roleMatch[1]] ?? roleMatch[1]
        : undefined;
      const excerptMatch = trimmed.match(/"excerpt":"((?:\\.|[^"\\])*)/);
      if (excerptMatch?.[1]) {
        const unescapedExcerpt = unescapeJsonStringFragment(excerptMatch[1]);
        const inner = extractReadableMessageText(unescapedExcerpt);
        return {
          roleLabel: inner.roleLabel ?? role,
          text: inner.text,
        };
      }
      const contentMatch = trimmed.match(/"content":"((?:\\.|[^"\\])*)/);
      if (contentMatch?.[1]) {
        const unescaped = unescapeJsonStringFragment(contentMatch[1]);
        return {
          roleLabel: role,
          text: formatReadableToolEnvelope(unescaped),
        };
      }
      const toolNameMatches = Array.from(
        trimmed.matchAll(/"name":"((?:\\.|[^"\\])*)"/g),
      )
        .map((m) => m[1])
        .filter((n): n is string => Boolean(n));
      if (toolNameMatches.length > 0) {
        return {
          roleLabel: role ?? "助手",
          text: `调用工具：${toolNameMatches.join("、")}`,
        };
      }
    }
  }

  const toolHeaderMatch = trimmed.match(
    /^\[tool (?:result|call)[^\]]*\]\s*([\s\S]*)$/,
  );
  if (toolHeaderMatch?.[1]) {
    return {
      roleLabel: "工具",
      text: formatReadableToolEnvelope(toolHeaderMatch[1]),
    };
  }

  return { text: trimmed };
}

export function extractReadablePlan(
  raw: string | null | undefined,
): MemoryPlanSummary | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") return undefined;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const title =
        typeof obj.title === "string" && obj.title.trim()
          ? obj.title.trim()
          : undefined;
      const explanation =
        typeof obj.explanation === "string" && obj.explanation.trim()
          ? obj.explanation.trim()
          : undefined;
      const steps = Array.isArray(obj.steps)
        ? obj.steps
            .map((item) => {
              if (typeof item === "object" && item !== null) {
                const s = item as Record<string, unknown>;
                if (typeof s.step === "string" && s.step.trim()) {
                  return {
                    step: s.step.trim(),
                    status: typeof s.status === "string" ? s.status : "pending",
                  };
                }
              }
              return null;
            })
            .filter(
              (item): item is { step: string; status: string } => item !== null,
            )
        : [];
      if (title || explanation || steps.length > 0) {
        return { title, explanation, steps, truncated: false };
      }
    }
  } catch {
    const titleMatch = trimmed.match(/"title":"((?:\\.|[^"\\])*)/);
    const explanationMatch = trimmed.match(/"explanation":"((?:\\.|[^"\\])*)/);
    const steps: { step: string; status: string }[] = [];
    const stepRegex = /\{"step":"((?:\\.|[^"\\])*)","status":"([^"]+)"\}/g;
    for (const match of trimmed.matchAll(stepRegex)) {
      if (match[1]) {
        steps.push({
          step: unescapeJsonStringFragment(match[1]),
          status: match[2] ?? "pending",
        });
      }
    }
    const title = titleMatch?.[1]
      ? unescapeJsonStringFragment(titleMatch[1])
      : undefined;
    const explanation = explanationMatch?.[1]
      ? unescapeJsonStringFragment(explanationMatch[1])
      : undefined;
    if (title || explanation || steps.length > 0) {
      return { title, explanation, steps, truncated: true };
    }
  }
  return undefined;
}

function parseExcerptObject(value: unknown): MemoryExcerptBlock | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const ref =
    typeof obj.ref === "string"
      ? obj.ref
      : typeof obj.id === "string"
        ? obj.id
        : undefined;
  const rawText =
    typeof obj.text === "string"
      ? obj.text
      : typeof obj.excerpt === "string"
        ? obj.excerpt
        : "";
  if (!rawText.trim()) return undefined;
  const extracted = extractReadableMessageText(rawText);
  const roleLabel =
    extracted.roleLabel ??
    (typeof obj.role === "string"
      ? ROLE_LABELS[obj.role] ?? obj.role
      : undefined);
  if (!extracted.text.trim()) return undefined;
  return {
    ref,
    roleLabel,
    text: extracted.text,
    rawText,
    truncated: Boolean(obj.truncated),
  };
}

function tryParseWorkingStateRecord(
  record: Record<string, unknown>,
  archiveRange?: string,
  truncated = false,
): ParsedContextMemory | undefined {
  const hasWorkingStateShape =
    typeof record.goal === "string" &&
    WORKING_STATE_SECTIONS.some(({ key }) => Array.isArray(record[key]));
  if (!hasWorkingStateShape) return undefined;

  const sections: MemorySectionGroup[] = [];
  for (const { key, label } of WORKING_STATE_SECTIONS) {
    const rawList = record[key];
    if (!Array.isArray(rawList)) continue;
    const items: MemoryRefItem[] = [];
    for (const entry of rawList) {
      if (typeof entry === "object" && entry !== null) {
        const itemObj = entry as Record<string, unknown>;
        if (typeof itemObj.text === "string" && itemObj.text.trim()) {
          const refs = Array.isArray(itemObj.refs)
            ? itemObj.refs.filter((r): r is string => typeof r === "string")
            : [];
          items.push({ text: itemObj.text.trim(), refs });
        }
      } else if (typeof entry === "string" && entry.trim()) {
        items.push({ text: entry.trim(), refs: [] });
      }
    }
    if (items.length > 0) {
      sections.push({ key, label, items });
    }
  }

  return {
    kind: "working_state",
    archiveRange,
    goal: (record.goal as string).trim(),
    sections,
    truncated,
  };
}

function salvageTruncatedWorkingState(
  jsonCandidate: string,
  archiveRange?: string,
): ParsedContextMemory | undefined {
  const goalMatch = jsonCandidate.match(/"goal":"((?:\\.|[^"\\])*)/);
  if (!goalMatch?.[1]) return undefined;

  const sections: MemorySectionGroup[] = [];
  for (const { key, label } of WORKING_STATE_SECTIONS) {
    const keyMarker = `"${key}":[`;
    const startIdx = jsonCandidate.indexOf(keyMarker);
    if (startIdx === -1) continue;
    const afterStart = jsonCandidate.slice(startIdx + keyMarker.length);
    const nextSectionIndices = WORKING_STATE_SECTIONS.map(({ key: otherKey }) =>
      otherKey === key ? -1 : afterStart.indexOf(`"${otherKey}":[`),
    ).filter((idx) => idx !== -1);
    const sectionSlice =
      nextSectionIndices.length > 0
        ? afterStart.slice(0, Math.min(...nextSectionIndices))
        : afterStart;

    const items: MemoryRefItem[] = [];
    const itemRegex = /\{"text":"((?:\\.|[^"\\])*)","refs":\[([^\]]*)\]\}/g;
    for (const match of sectionSlice.matchAll(itemRegex)) {
      const text = unescapeJsonStringFragment(match[1] ?? "").trim();
      if (!text) continue;
      const refs = Array.from((match[2] ?? "").matchAll(/"(m\d+)"/g)).map(
        (m) => m[1] ?? "",
      ).filter(Boolean);
      items.push({ text, refs });
    }
    if (items.length === 0) {
      const partialMatch = sectionSlice.match(/\{"text":"((?:\\.|[^"\\])*)/);
      if (partialMatch?.[1]) {
        const text = unescapeJsonStringFragment(partialMatch[1]).trim();
        if (text) items.push({ text, refs: [], truncated: true });
      }
    }
    if (items.length > 0) {
      sections.push({ key, label, items });
    }
  }

  return {
    kind: "working_state",
    archiveRange,
    goal: unescapeJsonStringFragment(goalMatch[1]).trim(),
    sections,
    truncated: true,
  };
}

function formatTimestamp(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function tryParseRunCheckpointRecord(
  record: Record<string, unknown>,
  archiveRange?: string,
  depth = 0,
): ParsedContextMemory | undefined {
  const isRunCheckpoint =
    typeof record.status === "string" &&
    ("latestRequest" in record ||
      "latestAssistantReport" in record ||
      "toolObservations" in record ||
      "endedAt" in record);
  if (!isRunCheckpoint) return undefined;

  const statusRaw = record.status as string;
  const statusLabel = STATUS_LABELS[statusRaw] ?? statusRaw;
  const endedAt = formatTimestamp(
    typeof record.endedAt === "string" ? record.endedAt : undefined,
  );
  const initialRequest = parseExcerptObject(record.initialRequest);
  const latestRequest = parseExcerptObject(record.latestRequest);
  const latestAssistantReport = parseExcerptObject(
    record.latestAssistantReport,
  );
  const plan =
    typeof record.planExcerpt === "string"
      ? extractReadablePlan(record.planExcerpt)
      : undefined;
  const priorRaw =
    typeof record.priorMemoryExcerpt === "string"
      ? record.priorMemoryExcerpt.trim()
      : "";
  const priorMemory =
    depth < 2 && priorRaw ? parseContextMemory(priorRaw, depth + 1) : undefined;
  const priorMemoryTruncated = Boolean(priorRaw && priorRaw.length >= 1150);
  const toolObservations = Array.isArray(record.toolObservations)
    ? record.toolObservations
        .map((item) => parseExcerptObject(item))
        .filter((item): item is MemoryExcerptBlock => item !== undefined)
    : [];

  return {
    kind: "run_checkpoint",
    archiveRange,
    statusLabel,
    endedAt,
    effectsMayBeUncertain: Boolean(record.effectsMayBeUncertain),
    initialRequest,
    latestRequest,
    latestAssistantReport,
    plan,
    priorMemory,
    priorMemoryTruncated,
    toolObservations,
  };
}

function parseExcerptLines(rawLines: string): readonly MemoryExcerptBlock[] {
  const results: MemoryExcerptBlock[] = [];
  for (const line of rawLines.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "…" || trimmed === "[]") continue;
    if (trimmed.startsWith("[")) {
      try {
        const arr: unknown = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === "object" && item !== null) {
              const extracted = extractReadableMessageText(
                JSON.stringify(item),
              );
              if (extracted.text.trim()) {
                results.push({
                  roleLabel: extracted.roleLabel,
                  text: extracted.text,
                });
              }
            }
          }
          continue;
        }
      } catch {
        // Fall through to single-item extraction
      }
    }
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const block = parseExcerptObject(parsed);
        if (block) {
          results.push(block);
          continue;
        }
      } catch {
        // Fall through to regex extraction
      }
      const idMatch = trimmed.match(/"(?:id|ref)":"(m\d+)"/);
      const extracted = extractReadableMessageText(trimmed);
      if (extracted.text.trim()) {
        results.push({
          ref: idMatch?.[1],
          roleLabel: extracted.roleLabel,
          text: extracted.text,
          rawText: trimmed,
          truncated:
            trimmed.includes('"truncated":true') || !trimmed.endsWith("}"),
        });
        continue;
      }
    }
    results.push({ text: trimmed });
  }
  return results;
}

export function parseContextMemory(
  content: string,
  depth = 0,
): ParsedContextMemory {
  const trimmed = content.trim();
  const archiveMatch =
    trimmed.match(/Archive:\s*(m\d+\.\.m\d+)/i) ??
    trimmed.match(/records\s+(m\d+\.\.m\d+)/i);
  const archiveRange = archiveMatch?.[1];

  // 1. Check Working state JSON format ("Working state:\n{...}")
  const workingStateMarker = "Working state:\n";
  const workingStateIdx = trimmed.indexOf(workingStateMarker);
  if (workingStateIdx !== -1) {
    const jsonCandidate = trimmed
      .slice(workingStateIdx + workingStateMarker.length)
      .trim();
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const ws = tryParseWorkingStateRecord(
          parsed as Record<string, unknown>,
          archiveRange,
          false,
        );
        if (ws) return ws;
      }
    } catch {
      const salvaged = salvageTruncatedWorkingState(
        jsonCandidate,
        archiveRange,
      );
      if (salvaged) return salvaged;
    }
  }

  // 2. Check Run-end checkpoint format ("Local run-end checkpoint...\n{...}")
  if (trimmed.startsWith("Local run-end checkpoint")) {
    const newlineIdx = trimmed.indexOf("\n");
    if (newlineIdx !== -1) {
      const jsonCandidate = trimmed.slice(newlineIdx + 1).trim();
      try {
        const parsed: unknown = JSON.parse(jsonCandidate);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          const rc = tryParseRunCheckpointRecord(
            parsed as Record<string, unknown>,
            archiveRange,
            depth,
          );
          if (rc) return rc;
        }
      } catch {
        // Fall through if malformed
      }
    }
  }

  // 3. Check WORKING STATE INCOMPLETE or SUMMARY INCOMPLETE fallback format
  if (
    trimmed.includes("WORKING STATE INCOMPLETE") ||
    trimmed.includes("SUMMARY INCOMPLETE")
  ) {
    const unsummarizedMatch = trimmed.match(/Unsummarized ranges:\s*([^\n]+)/);
    const prevIdx = trimmed.indexOf("Previous state:\n");
    const retainedIdx = trimmed.indexOf("Retained memory:\n");
    const planIdx = trimmed.indexOf("\nDurable plan:\n");
    const latestIdx = trimmed.indexOf("\nLatest excerpts:\n");
    const partialIdx = trimmed.indexOf("\nPartial excerpts:\n");

    let previousRaw = "";
    if (prevIdx !== -1) {
      const start = prevIdx + "Previous state:\n".length;
      const end =
        planIdx !== -1
          ? planIdx
          : latestIdx !== -1
            ? latestIdx
            : trimmed.length;
      previousRaw = trimmed.slice(start, end).trim();
    } else if (retainedIdx !== -1) {
      const start = retainedIdx + "Retained memory:\n".length;
      const end = partialIdx !== -1 ? partialIdx : trimmed.length;
      previousRaw = trimmed.slice(start, end).trim();
    }

    let planRaw = "";
    if (planIdx !== -1) {
      const start = planIdx + "\nDurable plan:\n".length;
      const end = latestIdx !== -1 ? latestIdx : trimmed.length;
      planRaw = trimmed.slice(start, end).trim();
    }

    let excerptsRaw = "";
    if (latestIdx !== -1) {
      excerptsRaw = trimmed
        .slice(latestIdx + "\nLatest excerpts:\n".length)
        .trim();
    } else if (partialIdx !== -1) {
      excerptsRaw = trimmed
        .slice(partialIdx + "\nPartial excerpts:\n".length)
        .trim();
    }

    const previousState =
      depth < 2 && previousRaw
        ? parseContextMemory(previousRaw, depth + 1)
        : undefined;
    const previousStateTruncated = Boolean(
      previousRaw && previousRaw.length >= 1950,
    );
    const plan = extractReadablePlan(planRaw);
    const excerpts = excerptsRaw ? parseExcerptLines(excerptsRaw) : [];

    return {
      kind: "fallback_state",
      archiveRange,
      unsummarizedRanges: unsummarizedMatch?.[1]?.trim(),
      previousState,
      previousStateTruncated,
      plan,
      excerpts,
    };
  }

  // 4. Direct JSON object or JSON on last line
  const jsonStart = trimmed.startsWith("{")
    ? 0
    : trimmed.lastIndexOf("\n{") !== -1
      ? trimmed.lastIndexOf("\n{") + 1
      : -1;
  if (jsonStart !== -1) {
    const jsonCandidate = trimmed.slice(jsonStart).trim();
    try {
      const parsed: unknown = JSON.parse(jsonCandidate);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const record = parsed as Record<string, unknown>;
        const ws = tryParseWorkingStateRecord(record, archiveRange, false);
        if (ws) return ws;
        const rc = tryParseRunCheckpointRecord(record, archiveRange, depth);
        if (rc) return rc;

        const entries = Object.entries(record)
          .filter(([, val]) => val !== null && val !== undefined && val !== "")
          .map(([key, val]) => ({
            key,
            label: GENERIC_KEY_LABELS[key] ?? key,
            value:
              typeof val === "string"
                ? extractReadableMessageText(val).text
                : JSON.stringify(val, null, 2),
          }));
        if (entries.length > 0) {
          return {
            kind: "structured_json",
            archiveRange,
            entries,
          };
        }
      }
    } catch {
      const salvaged = salvageTruncatedWorkingState(
        jsonCandidate,
        archiveRange,
      );
      if (salvaged) return salvaged;
    }
  }

  // 5. Clean Markdown / plain text fallback (strip internal prompt header boilerplate)
  const cleanedLines = trimmed
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("Archive:") &&
        !line.startsWith("Context memory (untrusted summary") &&
        !line.startsWith("Local run-end checkpoint;"),
    );

  return {
    kind: "markdown",
    archiveRange,
    text: cleanedLines.join("\n").trim() || trimmed,
  };
}
