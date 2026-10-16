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
import { useId, useState } from "react";
import "./tool-disclosure.css";

export interface ToolDisclosureProps {
  readonly toolName: string;
  readonly target?: string;
  readonly status: "running" | "completed" | "failed";
  readonly durationMs?: number;
  readonly timestamp?: string;
  readonly parameters?: Record<string, unknown> | string;
  readonly output?: string | null;
  readonly exitCode?: number | null;
  readonly error?: string | null;
  readonly truncated?: boolean;
  readonly defaultExpanded?: boolean;
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

export function ToolDisclosure({
  toolName,
  target,
  status,
  durationMs,
  timestamp,
  parameters,
  output,
  exitCode,
  error,
  truncated = false,
  defaultExpanded = false,
  className = "",
}: ToolDisclosureProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const detailsId = useId();
  const label = friendlyLabel(toolName);

  const formattedParams =
    typeof parameters === "string"
      ? parameters
      : parameters
        ? JSON.stringify(parameters, null, 2)
        : null;

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
          <div className="tool-section">
            <span className="tool-section-title">参数输入</span>
            {formattedParams ? (
              <pre className="tool-section-content">{formattedParams}</pre>
            ) : (
              <span className="tool-section-empty">无参数</span>
            )}
          </div>

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
              {truncated && <span className="tool-truncated">（已截断）</span>}
            </span>
            {output === null || output === undefined || output === "" ? (
              <span className="tool-section-empty">工具未返回文本</span>
            ) : (
              <pre className="tool-section-content">{output}</pre>
            )}
          </div>

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
