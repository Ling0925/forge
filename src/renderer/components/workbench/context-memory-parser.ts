export interface MemoryRefItem {
  readonly text: string;
  readonly refs: readonly string[];
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
  readonly truncated?: boolean | undefined;
}

export interface MemoryPlanSummary {
  readonly title?: string | undefined;
  readonly explanation?: string | undefined;
  readonly steps: readonly {
    readonly step: string;
    readonly status: string;
  }[];
}

export type ParsedContextMemory =
  | {
      readonly kind: "working_state";
      readonly archiveRange?: string | undefined;
      readonly goal: string;
      readonly sections: readonly MemorySectionGroup[];
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
      readonly toolObservations: readonly MemoryExcerptBlock[];
    }
  | {
      readonly kind: "fallback_state";
      readonly archiveRange?: string | undefined;
      readonly unsummarizedRanges?: string | undefined;
      readonly previousState?: ParsedContextMemory | undefined;
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
  } catch {
    const contentMatch = trimmed.match(/"(?:stdout|content|output|error)":"((?:\\.|[^"\\])*)/);
    if (contentMatch?.[1]) {
      return unescapeJsonStringFragment(contentMatch[1]).trim();
    }
  }
  return trimmed;
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
        const role = typeof record.role === "string" ? ROLE_LABELS[record.role] ?? record.role : undefined;
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
      const role = roleMatch?.[1] ? ROLE_LABELS[roleMatch[1]] ?? roleMatch[1] : undefined;
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
    }
  }

  const toolHeaderMatch = trimmed.match(/^\[tool (?:result|call)[^\]]*\]\s*([\s\S]*)$/);
  if (toolHeaderMatch?.[1]) {
    return {
      roleLabel: "工具",
      text: formatReadableToolEnvelope(toolHeaderMatch[1]),
    };
  }

  return { text: trimmed };
}

export function extractReadablePlan(raw: string | null | undefined): MemoryPlanSummary | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null") return undefined;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : undefined;
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
            .filter((item): item is { step: string; status: string } => item !== null)
        : [];
      if (title || explanation || steps.length > 0) {
        return { title, explanation, steps };
      }
    }
  } catch {
    const titleMatch = trimmed.match(/"title":"((?:\\.|[^"\\])*)"/);
    const explanationMatch = trimmed.match(/"explanation":"((?:\\.|[^"\\])*)"/);
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
    const title = titleMatch?.[1] ? unescapeJsonStringFragment(titleMatch[1]) : undefined;
    const explanation = explanationMatch?.[1]
      ? unescapeJsonStringFragment(explanationMatch[1])
      : undefined;
    if (title || explanation || steps.length > 0) {
      return { title, explanation, steps };
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
    (typeof obj.role === "string" ? ROLE_LABELS[obj.role] ?? obj.role : undefined);
  if (!extracted.text.trim()) return undefined;
  return {
    ref,
    roleLabel,
    text: extracted.text,
    truncated: Boolean(obj.truncated),
  };
}

function tryParseWorkingStateRecord(
  record: Record<string, unknown>,
  archiveRange?: string,
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
  const latestAssistantReport = parseExcerptObject(record.latestAssistantReport);
  const plan =
    typeof record.planExcerpt === "string"
      ? extractReadablePlan(record.planExcerpt)
      : undefined;
  const priorMemory =
    depth < 2 &&
    typeof record.priorMemoryExcerpt === "string" &&
    record.priorMemoryExcerpt.trim()
      ? parseContextMemory(record.priorMemoryExcerpt, depth + 1)
      : undefined;
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
              const extracted = extractReadableMessageText(JSON.stringify(item));
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
          truncated: trimmed.includes('"truncated":true'),
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
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const ws = tryParseWorkingStateRecord(
          parsed as Record<string, unknown>,
          archiveRange,
        );
        if (ws) return ws;
      }
    } catch {
      const goalMatch = jsonCandidate.match(/"goal":"((?:\\.|[^"\\])*)/);
      if (goalMatch?.[1]) {
        return {
          kind: "working_state",
          archiveRange,
          goal: unescapeJsonStringFragment(goalMatch[1]),
          sections: [],
        };
      }
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
      const end = planIdx !== -1 ? planIdx : latestIdx !== -1 ? latestIdx : trimmed.length;
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
      excerptsRaw = trimmed.slice(latestIdx + "\nLatest excerpts:\n".length).trim();
    } else if (partialIdx !== -1) {
      excerptsRaw = trimmed.slice(partialIdx + "\nPartial excerpts:\n".length).trim();
    }

    const previousState =
      depth < 2 && previousRaw
        ? parseContextMemory(previousRaw, depth + 1)
        : undefined;
    const plan = extractReadablePlan(planRaw);
    const excerpts = excerptsRaw ? parseExcerptLines(excerptsRaw) : [];

    return {
      kind: "fallback_state",
      archiveRange,
      unsummarizedRanges: unsummarizedMatch?.[1]?.trim(),
      previousState,
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
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const ws = tryParseWorkingStateRecord(record, archiveRange);
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
      // Not valid standalone JSON; fall back to cleaned markdown
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
