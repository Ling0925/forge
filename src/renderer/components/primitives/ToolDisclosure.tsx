import {
  CaretRight,
  Check,
  FileCode,
  GitDiff,
  Globe,
  TerminalWindow,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
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
  git_status: "查看 Git 状态",
  git_diff: "查看差异",
  git_log: "查看提交记录",
  browser_navigate: "打开网页",
  browser_read: "读取网页",
  browser_click: "点击网页",
  browser_fill: "填写网页",
  browser_screenshot: "截取网页",
  browser_close: "关闭浏览器",
};

function friendlyLabel(name: string): string {
  const known = friendlyLabels[name];
  if (known) return known;
  if (name.startsWith("mcp_")) return "MCP 工具";
  return "工具调用";
}

function getToolIcon(name: string) {
  if (name.includes("file") || name.includes("directory")) {
    return <FileCode size={16} weight="regular" />;
  }
  if (
    name.includes("command") ||
    name.includes("shell") ||
    name.includes("terminal")
  ) {
    return <TerminalWindow size={16} weight="regular" />;
  }
  if (name.includes("browser")) {
    return <Globe size={16} weight="regular" />;
  }
  if (name.includes("diff") || name.includes("git")) {
    return <GitDiff size={16} weight="regular" />;
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

/** Human labels for the most common tool argument keys. */
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
};

/** Best-effort pretty print for non-scalar argument values. */
function prettyValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Argument values stay readable without dumping the whole raw JSON blob. */
function paramValue(value: unknown): ReactNode {
  if (value === null || value === undefined)
    return <span className="tool-param-empty">空</span>;
  if (typeof value === "string")
    return value === "" ? (
      <span className="tool-param-empty">空</span>
    ) : (
      <span className="tool-param-text">
        {value.length > 2000 ? `${value.slice(0, 2000)}…` : value}
      </span>
    );
  if (typeof value === "number" || typeof value === "boolean")
    return <span className="tool-param-scalar">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="tool-param-empty">空</span>;
    if (value.every((item) => typeof item !== "object" || item === null))
      return (
        <span className="tool-param-chips">
          {value.map((item, index) => (
            <span className="tool-param-chip" key={`${String(item)}-${index}`}>
              {String(item)}
            </span>
          ))}
        </span>
      );
  }
  return <pre className="tool-param-json">{prettyValue(value)}</pre>;
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
  const entries = Object.entries(record);
  if (entries.length === 0)
    return <span className="tool-section-empty">无参数</span>;
  return (
    <dl className="tool-params">
      {entries.map(([key, value]) => (
        <div className="tool-param-row" key={key}>
          <dt className="tool-param-key">{paramLabels[key] ?? key}</dt>
          <dd className="tool-param-value">{paramValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Result payloads: parsed key/value rows for a JSON object, plain text otherwise. */
function ResultFields({ output }: { readonly output: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return <pre className="tool-section-content">{output}</pre>;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length === 0
  )
    return <pre className="tool-section-content">{output}</pre>;
  const record = parsed as Record<string, unknown>;
  return (
    <dl className="tool-params">
      {Object.entries(record).map(([key, value]) => (
        <div className="tool-param-row" key={key}>
          <dt className="tool-param-key">{paramLabels[key] ?? key}</dt>
          <dd className="tool-param-value">{paramValue(value)}</dd>
        </div>
      ))}
    </dl>
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
  defaultExpanded = false,
  autoCollapsed = false,
  className = "",
}: ToolDisclosureProps) {
  // Command rows and file edits open by default: a command reads as one
  // command+result unit, and a file edit shows its diff preview without a
  // click. The diff itself only previews its leading lines until expanded.
  const writesFiles = toolName === "edit_file" || toolName === "write_file";
  const isCommand = toolName === "run_command";
  const [expanded, setExpanded] = useState(
    defaultExpanded || writesFiles || isCommand,
  );
  const detailsId = useId();
  const label = friendlyLabel(toolName);

  // Phases fold once when they pass into history. Remember which phase already
  // folded so a manual reopen is respected until the item enters a new phase.
  const foldedPhase = useRef(false);
  useEffect(() => {
    if (autoCollapsed && !foldedPhase.current) {
      foldedPhase.current = true;
      setExpanded(false);
    } else if (!autoCollapsed) {
      foldedPhase.current = false;
    }
  }, [autoCollapsed]);

  const parsedParams = parseParams(parameters);

  // Total added/removed lines across this tool's file changes, for the header.
  const diffTotals = (changes ?? []).reduce(
    (total, change) => {
      const stats = diffStats(change.before, change.after);
      return {
        added: total.added + stats.added,
        removed: total.removed + stats.removed,
      };
    },
    { added: 0, removed: 0 },
  );

  const statusLabel =
    status === "running" ? "执行中" : status === "completed" ? "完成" : "失败";

  return (
    <section
      className={`tool-disclosure ${className}`.trim()}
      aria-label={`工具调用：${toolName}`}
      data-status={status}
    >
      <button
        type="button"
        className="tool-disclosure-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={detailsId}
      >
        <div className="tool-disclosure-summary">
          <span className="tool-disclosure-icon" aria-hidden="true">
            {getToolIcon(toolName)}
          </span>
          <span className="tool-disclosure-label">{label}</span>
          {target && (
            <span className="tool-disclosure-target" title={target}>
              {target}
            </span>
          )}
        </div>
        <div className="tool-disclosure-meta">
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
          {durationMs !== undefined && (
            <span className="tool-disclosure-time">
              {formatDuration(durationMs)}
            </span>
          )}
          {timestamp && durationMs === undefined && (
            <span className="tool-disclosure-time">{timestamp}</span>
          )}
          <StatusGlyph status={status} label={statusLabel} />
          <span
            className={`tool-disclosure-chevron ${expanded ? "is-expanded" : ""}`}
            aria-hidden="true"
          >
            <CaretRight size={14} weight="bold" />
          </span>
        </div>
      </button>

      {expanded && (
        <div id={detailsId} className="tool-disclosure-body">
          {/* A command card stays minimal: the executed command and its raw
              result only. Parsed argument/result rows would just duplicate the
              command line and clutter the evidence. */}
          {isCommand ? (
            <>
              {command && (
                <div className="tool-section">
                  <span className="tool-section-title">命令</span>
                  <pre className="tool-section-content tool-command">
                    {command}
                  </pre>
                  {cwd && (
                    <span className="tool-command-cwd">工作目录 {cwd}</span>
                  )}
                </div>
              )}
              <div className="tool-section">
                <span className="tool-section-title">
                  结果{" "}
                  {truncated && (
                    <span className="tool-truncated">（已截断）</span>
                  )}
                </span>
                {output === null || output === undefined || output === "" ? (
                  <span className="tool-section-empty">工具未返回文本</span>
                ) : (
                  <pre className="tool-section-content">{output}</pre>
                )}
              </div>
            </>
          ) : (
            <>
              {command && (
                <div className="tool-section">
                  <span className="tool-section-title">命令</span>
                  <pre className="tool-section-content tool-command">
                    {command}
                  </pre>
                  {cwd && (
                    <span className="tool-command-cwd">工作目录 {cwd}</span>
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
              {/* A file edit shows only the diff: its raw before/after argument
                  rows ("原内容"/"新内容") would just duplicate the comparison. */}
              {!writesFiles && (
                <div className="tool-section">
                  <span className="tool-section-title">参数输入</span>
                  <ParameterFields parameters={parsedParams} />
                </div>
              )}

              {exitCode !== undefined && exitCode !== null && (
                <div className="tool-section">
                  <span className="tool-section-title">退出码</span>
                  <span
                    className={`tool-exit tool-exit-${exitCode === 0 ? "ok" : "bad"}`}
                  >
                    {exitCode}
                  </span>
                </div>
              )}

              {error && (
                <div className="tool-section">
                  <span className="tool-section-title">执行错误</span>
                  <pre className="tool-section-content tool-section-error">
                    {error}
                  </pre>
                </div>
              )}

              <div className="tool-section">
                <span className="tool-section-title">
                  输出结果{" "}
                  {truncated && (
                    <span className="tool-truncated">（已截断）</span>
                  )}
                </span>
                {output === null || output === undefined || output === "" ? (
                  <span className="tool-section-empty">工具未返回文本</span>
                ) : (
                  <ResultFields output={output} />
                )}
              </div>
            </>
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
      )}
    </section>
  );
}
