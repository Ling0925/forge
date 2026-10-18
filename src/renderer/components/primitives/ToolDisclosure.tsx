import {
  CaretRight,
  Check,
  Copy,
  FilePlus,
  FileText,
  FolderPlus,
  GitDiff,
  Globe,
  ListBullets,
  ListChecks,
  MagnifyingGlass,
  PencilSimple,
  PuzzlePiece,
  TerminalWindow,
  WarningCircle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FileChange } from "../../shared-types";
import { DiffViewer, diffStats } from "./DiffViewer";
import "./tool-disclosure.css";

export interface ToolDisclosureProps {
  readonly toolName: string;
  readonly target?: string | undefined;
  readonly command?: string | undefined;
  readonly cwd?: string | undefined;
  readonly status: "running" | "completed" | "failed";
  readonly durationMs?: number;
  readonly timestamp?: string;
  readonly parameters?: Record<string, unknown> | string;
  readonly output?: string | null;
  readonly exitCode?: number | null;
  readonly error?: string | null;
  readonly changes?: readonly FileChange[] | undefined;
  readonly truncated?: boolean;
  readonly defaultExpanded?: boolean;
  /** When true, the row folds once as its phase becomes history (see the
   * transcript). The user can still reopen it; it is never forced shut twice. */
  readonly autoCollapsed?: boolean;
  readonly className?: string;
}

const friendlyLabels: Readonly<Record<string, string>> = {
  read_file: "读取文件",
  write_file: "写入文件",
  edit_file: "编辑文件",
  list_files: "列出文件",
  search_files: "搜索文件",
  make_directory: "创建目录",
  run_command: "运行命令",
  command_task: "查看后台命令",
  git_status: "查看 Git 状态",
  git_diff: "查看差异",
  git_log: "查看提交记录",
  browser_navigate: "打开网页",
  browser_read: "读取网页",
  browser_click: "点击网页",
  browser_fill: "填写网页",
  browser_screenshot: "截取网页",
  browser_close: "关闭浏览器",
  update_plan: "更新计划",
  mcp_list_tools: "列出 MCP 工具",
  mcp_call_tool: "调用 MCP 工具",
};

function friendlyLabel(name: string): string {
  const known = friendlyLabels[name];
  if (known) return known;
  if (name.startsWith("mcp_")) return "MCP 工具";
  return "工具调用";
}

/** One glyph per action family, so a long transcript is scannable by shape. */
function getToolIcon(name: string) {
  if (name === "read_file") return <FileText size={16} weight="regular" />;
  if (name === "write_file") return <FilePlus size={16} weight="regular" />;
  if (name === "edit_file") return <PencilSimple size={16} weight="regular" />;
  if (name === "make_directory")
    return <FolderPlus size={16} weight="regular" />;
  if (name === "list_files") return <ListBullets size={16} weight="regular" />;
  if (name === "search_files")
    return <MagnifyingGlass size={16} weight="regular" />;
  if (name === "update_plan") return <ListChecks size={16} weight="regular" />;
  if (name === "run_command" || name === "command_task") {
    return <TerminalWindow size={16} weight="regular" />;
  }
  if (name.startsWith("git_")) return <GitDiff size={16} weight="regular" />;
  if (name.startsWith("browser_")) return <Globe size={16} weight="regular" />;
  if (name.startsWith("mcp_"))
    return <PuzzlePiece size={16} weight="regular" />;
  if (name.includes("file") || name.includes("directory")) {
    return <FileText size={16} weight="regular" />;
  }
  return <Wrench size={16} weight="regular" />;
}

/** Compact, terminal-style durations: 480ms, 1.4s, 25s, 2m 5s. */
function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60)
    return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Local wall-clock for a start timestamp; null when it is not a real date. */
function formatClock(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleTimeString(undefined, { hour12: false });
}

function formatStamp(timestamp: string): string | undefined {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toLocaleString();
}

/**
 * Terminal-style status glyph (✓ / ✗ / spinner) instead of a status word. The
 * label is preserved for assistive tech only.
 */
function StatusGlyph({
  status,
  label,
}: {
  readonly status: ToolDisclosureProps["status"];
  readonly label: string;
}) {
  return (
    <span className="tool-disclosure-status" data-status={status}>
      {status === "completed" ? (
        <Check size={13} weight="bold" aria-hidden="true" />
      ) : status === "failed" ? (
        <X size={13} weight="bold" aria-hidden="true" />
      ) : (
        <span className="tool-disclosure-spinner" aria-hidden="true" />
      )}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

/**
 * Quiet copy action for a piece of evidence (command line, result, output). It
 * only ever claims a copy that really happened: an unavailable clipboard leaves
 * the label unchanged.
 */
function ToolCopyButton({
  text,
  label,
}: {
  readonly text: string;
  readonly label: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure origin, denied permission).
    }
  }, [text]);
  return (
    <button
      type="button"
      className={`tool-copy${copied ? " is-copied" : ""}`}
      onClick={() => void copy()}
      aria-label={copied ? "已复制" : label}
      title={copied ? "已复制" : label}
    >
      {copied ? (
        <Check size={12} weight="bold" aria-hidden="true" />
      ) : (
        <Copy size={12} aria-hidden="true" />
      )}
      <span>{copied ? "已复制" : "复制"}</span>
    </button>
  );
}

/** Human labels for the most common tool argument and result keys. */
const paramLabels: Readonly<Record<string, string>> = {
  path: "路径",
  file_path: "路径",
  pattern: "模式",
  glob: "匹配",
  query: "查询",
  needle: "查询",
  content: "内容",
  new_text: "新内容",
  old_text: "原内容",
  text: "文本",
  command: "命令",
  argv: "命令",
  cwd: "工作目录",
  url: "网址",
  selector: "选择器",
  value: "值",
  model: "模型",
  prompt: "提示词",
  line: "行",
  column: "列",
  limit: "上限",
  offset: "偏移",
  recursive: "递归",
  description: "说明",
  name: "名称",
  id: "ID",
  server: "服务",
  tool: "工具",
  mode: "模式",
  depth: "深度",
  task: "任务",
  origin: "来源",
  // Common result fields.
  edited: "已编辑",
  written: "已写入",
  unchanged: "无变化",
  created: "已创建",
  replacements: "替换",
  matches: "匹配数",
  entries: "条目数",
  exit_code: "退出码",
  stdout: "标准输出",
  stderr: "标准错误",
  error: "错误",
  total_lines: "总行数",
  truncated: "已截断",
  scan_truncated: "扫描不完整",
  // Console and result metadata.
  status: "状态",
  signal: "信号",
  duration_ms: "进程耗时",
  timed_out: "已超时",
  spawn_failed: "启动失败",
  partial_line: "末行不完整",
  size_bytes: "字节数",
  lines_returned: "返回行数",
  next_offset: "下一页偏移",
  total_chars: "总字符数",
  output_available: "输出可用",
  output_truncated: "原始输出已截断",
};

/** Best-effort pretty print for non-scalar argument values. */
function prettyValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

const BLOCK_TEXT_LIMIT = 12000;

interface RenderedValue {
  /** True when the value owns a full row: multiline or long text, JSON bodies. */
  readonly block: boolean;
  readonly node: ReactNode;
}

/**
 * Argument and result values stay readable without dumping the whole raw JSON
 * blob. Multi-line and long strings become their own block so line breaks,
 * indentation and log structure survive; scalars stay on one quiet line.
 */
function renderValue(value: unknown): RenderedValue {
  if (value === null || value === undefined)
    return { block: false, node: <span className="tool-param-empty">空</span> };
  if (typeof value === "string") {
    if (value === "")
      return {
        block: false,
        node: <span className="tool-param-empty">空</span>,
      };
    if (value.includes("\n") || value.length > 160) {
      const clipped = value.length > BLOCK_TEXT_LIMIT;
      return {
        block: true,
        node: (
          <pre className="tool-param-block">
            {clipped ? value.slice(0, BLOCK_TEXT_LIMIT) : value}
            {clipped && <span className="tool-param-empty">…（已截断）</span>}
          </pre>
        ),
      };
    }
    return {
      block: false,
      node: <span className="tool-param-text">{value}</span>,
    };
  }
  if (typeof value === "number" || typeof value === "boolean")
    return {
      block: false,
      node: <span className="tool-param-scalar">{String(value)}</span>,
    };
  if (Array.isArray(value)) {
    if (value.length === 0)
      return {
        block: false,
        node: <span className="tool-param-empty">空</span>,
      };
    if (value.every((item) => typeof item !== "object" || item === null))
      return {
        block: false,
        node: (
          <span className="tool-param-chips">
            {value.map((item, index) => (
              <span
                className="tool-param-chip"
                key={`${String(item)}-${index}`}
              >
                {String(item)}
              </span>
            ))}
          </span>
        ),
      };
  }
  return {
    block: true,
    node: <pre className="tool-param-json">{prettyValue(value)}</pre>,
  };
}

/** Labelled rows for one argument or result object. */
function ValueRows({
  record,
  skip,
}: {
  readonly record: Record<string, unknown>;
  readonly skip?: ReadonlySet<string>;
}) {
  const entries = Object.entries(record).filter(([key]) => !skip?.has(key));
  if (entries.length === 0)
    return <span className="tool-section-empty">无其他字段</span>;
  return (
    <dl className="tool-params">
      {entries.map(([key, value]) => {
        const rendered = renderValue(value);
        return (
          <div
            className={
              rendered.block ? "tool-param-row is-block" : "tool-param-row"
            }
            key={key}
          >
            <dt className="tool-param-key">{paramLabels[key] ?? key}</dt>
            <dd className="tool-param-value">{rendered.node}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Parse the persisted argument string without throwing on malformed input. */
function parseParams(parameters: ToolDisclosureProps["parameters"]): unknown {
  if (typeof parameters !== "string") return parameters ?? null;
  try {
    return JSON.parse(parameters);
  } catch {
    return parameters;
  }
}

/**
 * Parsed argument card: labelled rows for object arguments instead of one raw
 * JSON blob. Malformed or non-object parameters fall back to plain text.
 */
function ParameterFields({ parameters }: { readonly parameters: unknown }) {
  const record =
    typeof parameters === "object" &&
    parameters !== null &&
    !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : null;
  if (!record)
    return parameters ? (
      <pre className="tool-param-json">{prettyValue(parameters)}</pre>
    ) : (
      <span className="tool-section-empty">无参数</span>
    );
  if (Object.keys(record).length === 0)
    return <span className="tool-section-empty">无参数</span>;
  return <ValueRows record={record} />;
}

type ParsedResult =
  | { readonly kind: "object"; readonly record: Record<string, unknown> }
  | { readonly kind: "text"; readonly text: string };

/** Result payloads: key/value rows for a JSON object, plain text otherwise. */
function parseResult(output: string): ParsedResult {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    )
      return { kind: "object", record: parsed as Record<string, unknown> };
  } catch {
    // Plain text is the normal shape for command output and free-form results.
  }
  return { kind: "text", text: output };
}

interface ConsoleFact {
  readonly label: string;
  readonly value: string;
}

interface CommandConsoleModel {
  /** The console body: stdout for a command, `output` for a background task. */
  readonly body: string | null;
  readonly stderr: string | null;
  readonly error: string | null;
  readonly exitCode: number | null;
  readonly notices: readonly string[];
  readonly facts: readonly ConsoleFact[];
  /** A background task whose output has not been produced yet. */
  readonly pending: boolean;
}

const consoleBodyKeys = ["stdout", "output"] as const;
const consoleConsumedKeys: ReadonlySet<string> = new Set([
  ...consoleBodyKeys,
  "stderr",
  "error",
  "exit_code",
  "signal",
  "timed_out",
  "spawn_failed",
  "truncated",
  "output_truncated",
  "duration_ms",
]);

function scalarFact(value: unknown): string | null {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.length <= 160) return value;
  return null;
}

/**
 * Command results arrive as the tool's own JSON envelope
 * (`{stdout, stderr, exit_code, …}`); the card decodes that envelope instead of
 * printing escaped JSON at the reader. Anything unrecognised is shown verbatim.
 */
function decodeCommandConsole(
  output: string | null | undefined,
  toolName: string,
): CommandConsoleModel {
  const text = typeof output === "string" ? output : "";
  let record: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      record = parsed as Record<string, unknown>;
  } catch {
    // Plain console output.
  }
  if (!record)
    return {
      // An empty string means "no output", not an empty console viewport.
      body: text === "" ? null : text,
      stderr: null,
      error: null,
      exitCode: null,
      notices: [],
      facts: [],
      pending: false,
    };
  const stringField = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  const numberField = (key: string) => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const body =
    consoleBodyKeys
      .map((key) => stringField(key))
      .find((value) => value !== null) ?? null;
  const pending = record.output_available === false;
  const notices: string[] = [];
  if (record.timed_out === true) notices.push("命令超时后已被终止。");
  if (record.spawn_failed === true) notices.push("进程未能启动。");
  const signal = stringField("signal");
  if (signal) notices.push(`命令被信号 ${signal} 终止。`);
  if (record.output_truncated === true)
    notices.push("原始输出已在上限处截断。");
  if (record.truncated === true)
    notices.push(
      toolName === "command_task"
        ? "这是分页结果，还有更多输出可继续读取。"
        : "输出超出采集上限，已停止采集。",
    );
  const facts: ConsoleFact[] = [];
  const duration = numberField("duration_ms");
  if (duration !== null)
    facts.push({
      label: paramLabels.duration_ms ?? "进程耗时",
      value: formatDuration(duration),
    });
  for (const [key, value] of Object.entries(record)) {
    if (facts.length >= 8) break;
    if (consoleConsumedKeys.has(key)) continue;
    const fact = scalarFact(value);
    if (fact === null) continue;
    facts.push({ label: paramLabels[key] ?? key, value: fact });
  }
  return {
    body,
    stderr: stringField("stderr"),
    error: stringField("error"),
    exitCode: numberField("exit_code"),
    notices,
    facts,
    pending,
  };
}

function SectionHead({
  title,
  action,
}: {
  readonly title: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="tool-section-head">
      <span className="tool-section-title">{title}</span>
      {action}
    </div>
  );
}

/** The integrated console: the command, its streams and its exit code as one unit. */
function CommandConsole({
  command,
  cwd,
  error,
  exitCode,
  model,
  status,
}: {
  readonly command?: string | undefined;
  readonly cwd?: string | undefined;
  readonly error?: string | null;
  readonly exitCode?: number | null;
  readonly model: CommandConsoleModel;
  readonly status: ToolDisclosureProps["status"];
}) {
  const resolvedExit = exitCode ?? model.exitCode;
  const failure = error ?? model.error;
  const emptyText = model.pending
    ? "命令仍在运行，输出尚未生成。"
    : status === "running"
      ? "等待命令输出…"
      : "工具未返回文本";
  return (
    <div className="tool-terminal-card">
      {command && (
        <div className="tool-terminal-header tool-section">
          <div className="tool-terminal-prompt">
            <span className="tool-section-title">
              <span className="tool-terminal-sigil" aria-hidden="true">
                $
              </span>
              命令
            </span>
            <pre className="tool-section-content tool-command">{command}</pre>
          </div>
          <div className="tool-terminal-header-meta">
            {cwd && (
              <span className="tool-command-cwd" title={`工作目录：${cwd}`}>
                工作目录 {cwd}
              </span>
            )}
            <ToolCopyButton text={command} label="复制命令" />
          </div>
        </div>
      )}
      <div className="tool-terminal-output tool-section">
        <SectionHead
          title="结果"
          action={
            <div className="tool-section-actions">
              {resolvedExit !== undefined && resolvedExit !== null && (
                <span
                  className={`tool-exit tool-exit-${resolvedExit === 0 ? "ok" : "bad"}`}
                >
                  退出码 {resolvedExit}
                </span>
              )}
              {model.body !== null && (
                <ToolCopyButton text={model.body} label="复制输出" />
              )}
            </div>
          }
        />
        {failure && (
          <pre className="tool-section-content tool-section-error">
            {failure}
          </pre>
        )}
        {model.stderr !== null && model.stderr !== "" && (
          <>
            <span className="tool-section-title tool-stream-title">
              标准错误
            </span>
            <pre className="tool-section-content tool-console-stderr">
              {model.stderr}
            </pre>
          </>
        )}
        {model.body === null ? (
          failure ? null : (
            <span className="tool-section-empty">{emptyText}</span>
          )
        ) : (
          <pre className="tool-section-content tool-terminal-pre">
            {model.body}
          </pre>
        )}
        {model.notices.map((notice) => (
          <p className="tool-notice" key={notice}>
            <WarningCircle size={13} weight="regular" aria-hidden="true" />
            {notice}
          </p>
        ))}
        {model.facts.length > 0 && (
          <div className="tool-console-facts">
            {model.facts.map((fact) => (
              <span className="tool-fact" key={fact.label}>
                <span className="tool-fact-label">{fact.label}</span>
                <span className="tool-fact-value">{fact.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ToolDisclosure({
  toolName,
  target,
  command,
  cwd,
  status,
  durationMs,
  timestamp,
  parameters,
  output,
  exitCode,
  error,
  changes,
  truncated = false,
  defaultExpanded,
  autoCollapsed = false,
  className = "",
}: ToolDisclosureProps) {
  const writesFiles = toolName === "edit_file" || toolName === "write_file";
  // A plain command's arguments are its command line (shown in the console); a
  // background task's arguments are the only record of the requested action.
  const isRunCommand = toolName === "run_command";
  const isConsole = isRunCommand || toolName === "command_task";
  const isWaiting = status === "running";
  const initialExpanded =
    defaultExpanded !== undefined
      ? defaultExpanded
      : isWaiting || writesFiles || status === "failed";
  const [expanded, setExpanded] = useState(initialExpanded);
  const manuallyToggled = useRef(false);
  const detailsId = useId();
  const label = friendlyLabel(toolName);
  const parsedParams = parseParams(parameters);
  const parameterPath =
    typeof parsedParams === "object" &&
    parsedParams !== null &&
    "path" in parsedParams &&
    typeof parsedParams.path === "string"
      ? parsedParams.path
      : undefined;
  const readPath =
    toolName === "read_file" ? parameterPath || target : undefined;
  const displayTarget = readPath
    ? readPath.split(/[\\/]/).pop() || readPath
    : target || (isRunCommand ? command : undefined);
  const showParameters = !writesFiles && !isRunCommand;

  useEffect(() => {
    if (
      defaultExpanded !== undefined ||
      manuallyToggled.current ||
      autoCollapsed
    )
      return;
    setExpanded(status !== "completed" || writesFiles);
  }, [status, writesFiles, defaultExpanded, autoCollapsed]);

  // Phases fold once when they pass into history. Remember which phase already
  // folded so a manual reopen is respected until the item enters a new phase.
  const foldedPhase = useRef(false);
  useEffect(() => {
    if (autoCollapsed && !foldedPhase.current) {
      foldedPhase.current = true;
      if (!manuallyToggled.current) setExpanded(false);
    } else if (!autoCollapsed) {
      foldedPhase.current = false;
    }
  }, [autoCollapsed]);

  // Total added/removed lines across this tool's file changes, for the header.
  // Counts come from the recorded patch (full originals); an unknown count is
  // skipped rather than reported as zero.
  const diffTotals = (changes ?? []).reduce(
    (total, change) => {
      const stats = diffStats(change);
      if (!stats) return total;
      return {
        added: total.added + stats.added,
        removed: total.removed + stats.removed,
      };
    },
    { added: 0, removed: 0 },
  );

  const statusLabel =
    status === "running" ? "执行中" : status === "completed" ? "完成" : "失败";

  const consoleModel = isConsole
    ? decodeCommandConsole(output, toolName)
    : null;
  const result =
    !isConsole && output !== null && output !== undefined && output !== ""
      ? parseResult(output)
      : null;
  const explicitReason =
    result?.kind === "object" && typeof result.record.error === "string"
      ? result.record.error
      : null;
  // A failed card leads with why it failed: the recorded reason, the plain-text
  // result, or an explicit statement that no reason was recorded. The reason is
  // shown once — a plain-text result becomes the reason instead of being
  // repeated under "结果".
  const textFailure = status === "failed" && result?.kind === "text";
  const failureReason =
    status === "failed"
      ? (error ??
        explicitReason ??
        (result?.kind === "text" ? result.text : null) ??
        (result ? null : "失败，但未记录具体原因。"))
      : null;
  // Only drop the `error` row when that exact text is already rendered above.
  const reasonShownAsFailure =
    failureReason !== null && explicitReason === failureReason;
  const hasResult =
    result !== null &&
    !(textFailure && result.kind === "text" && result.text === failureReason) &&
    !(
      result.kind === "object" &&
      reasonShownAsFailure &&
      Object.keys(result.record).length === 1
    );
  const clock = timestamp ? formatClock(timestamp) : null;
  const stamp = timestamp ? formatStamp(timestamp) : undefined;
  const resolvedExit = consoleModel
    ? (exitCode ?? consoleModel.exitCode)
    : (exitCode ?? null);

  return (
    <section
      className={`tool-disclosure ${className}`.trim()}
      aria-label={`工具调用：${toolName}`}
      data-status={status}
      data-tool={toolName}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="tool-disclosure-header"
        onClick={() => {
          manuallyToggled.current = true;
          setExpanded((value) => !value);
        }}
        aria-expanded={expanded}
        aria-controls={detailsId}
      >
        <div className="tool-disclosure-summary">
          <span className="tool-disclosure-icon" aria-hidden="true">
            {getToolIcon(toolName)}
          </span>
          <span className="tool-disclosure-label">{label}</span>
          {displayTarget && (
            <span
              className="tool-disclosure-target"
              title={readPath || displayTarget}
            >
              {displayTarget}
            </span>
          )}
        </div>
        <div className="tool-disclosure-meta">
          {status === "failed" && (
            <span className="tool-disclosure-failure">失败</span>
          )}
          {diffTotals.added > 0 && (
            <span className="tool-diff-stat tool-diff-added">
              +{diffTotals.added}
            </span>
          )}
          {diffTotals.removed > 0 && (
            <span className="tool-diff-stat tool-diff-removed">
              -{diffTotals.removed}
            </span>
          )}
          {(durationMs !== undefined || clock) && (
            <span
              className="tool-disclosure-time"
              {...(stamp === undefined ? {} : { title: stamp })}
            >
              {durationMs !== undefined
                ? formatDuration(durationMs)
                : (clock ?? "")}
            </span>
          )}
          <StatusGlyph status={status} label={statusLabel} />
          <span
            className={`tool-disclosure-chevron ${expanded ? "is-expanded" : ""}`}
            aria-hidden="true"
          >
            <CaretRight size={13} weight="bold" />
          </span>
        </div>
      </button>

      {expanded && (
        <div id={detailsId} className="tool-disclosure-body">
          {truncated && (
            <p className="tool-notice">
              <WarningCircle size={13} weight="regular" aria-hidden="true" />
              展示内容已截断（超出界面展示上限）。
            </p>
          )}
          {consoleModel ? (
            /* A command card stays minimal: the executed command and its raw
               result combined in one console viewport. */
            <CommandConsole
              command={command}
              cwd={cwd}
              model={consoleModel}
              status={status}
              {...(error === undefined || error === null ? {} : { error })}
              {...(exitCode === undefined || exitCode === null
                ? {}
                : { exitCode })}
            />
          ) : (
            <>
              {readPath &&
                (result?.kind !== "object" ||
                  result.record.path !== readPath) && (
                  <div className="tool-section tool-path-section">
                    <SectionHead title="文件路径" />
                    <pre className="tool-section-content tool-read-path">
                      {readPath}
                    </pre>
                  </div>
                )}
              {failureReason && (
                <div className="tool-section">
                  <SectionHead title="失败原因" />
                  <pre className="tool-section-content tool-section-error">
                    {failureReason}
                  </pre>
                </div>
              )}
              {command && (
                <div className="tool-section tool-command-section">
                  <SectionHead
                    title="命令"
                    action={<ToolCopyButton text={command} label="复制命令" />}
                  />
                  <pre className="tool-section-content tool-command">
                    {command}
                  </pre>
                  {cwd && (
                    <span
                      className="tool-command-cwd"
                      title={`工作目录：${cwd}`}
                    >
                      工作目录 {cwd}
                    </span>
                  )}
                </div>
              )}
              {changes && changes.length > 0 && (
                <div className="tool-section">
                  <span className="tool-section-title">
                    文件改动{" "}
                    <span className="tool-diff-count">
                      （{changes.length}）
                    </span>
                  </span>
                  <div className="tool-diffs">
                    {changes.map((change, i) => (
                      <DiffViewer
                        change={change}
                        isSuggested={false}
                        key={`${change.path}-${i}`}
                      />
                    ))}
                  </div>
                </div>
              )}
              {error && error !== failureReason && (
                <div className="tool-section">
                  <SectionHead title="执行错误" />
                  <pre className="tool-section-content tool-section-error">
                    {error}
                  </pre>
                </div>
              )}
              {resolvedExit !== undefined && resolvedExit !== null && (
                <div className="tool-section">
                  <SectionHead title="退出码" />
                  <span
                    className={`tool-exit tool-exit-${resolvedExit === 0 ? "ok" : "bad"}`}
                  >
                    {resolvedExit}
                  </span>
                </div>
              )}
              {(hasResult ||
                (!result && !failureReason && !changes?.length)) && (
                <div className="tool-section">
                  <SectionHead
                    title="结果"
                    {...(result?.kind === "text" && hasResult
                      ? {
                          action: (
                            <ToolCopyButton
                              text={result.text}
                              label="复制结果"
                            />
                          ),
                        }
                      : {})}
                  />
                  {!result ? (
                    <span className="tool-section-empty">
                      {isWaiting ? "等待工具返回结果…" : "工具未返回文本"}
                    </span>
                  ) : result.kind === "text" ? (
                    <pre className="tool-section-content">{result.text}</pre>
                  ) : (
                    <ValueRows
                      record={result.record}
                      {...(reasonShownAsFailure
                        ? { skip: new Set(["error"]) }
                        : {})}
                    />
                  )}
                </div>
              )}
            </>
          )}

          <div className="tool-disclosure-footer">
            {showParameters && !isConsole && (
              <details className="tool-details">
                <summary className="tool-debug-summary">
                  <CaretRight size={11} weight="bold" aria-hidden="true" />
                  调用参数
                </summary>
                <ParameterFields parameters={parsedParams} />
              </details>
            )}
            {/* Raw protocol fields stay collapsed by default, out of the main read. */}
            <details className="tool-debug">
              <summary className="tool-debug-summary">
                <CaretRight size={11} weight="bold" aria-hidden="true" />
                调试信息
              </summary>
              <div className="tool-section">
                <span className="tool-section-title">原生名称</span>
                <pre className="tool-section-content">{toolName}</pre>
              </div>
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
