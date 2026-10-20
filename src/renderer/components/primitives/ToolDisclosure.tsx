import {
  CaretRight,
  Check,
  CheckCircle,
  Circle,
  CircleDashed,
  Coins,
  Copy,
  Cpu,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Funnel,
  GitDiff,
  Globe,
  HardDrive,
  Lightning,
  ListBullets,
  ListChecks,
  ListNumbers,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  PuzzlePiece,
  Robot,
  ShieldCheck,
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
import { Collapsible } from "./Collapsible";
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
  append_file: "追加文件",
  edit_file: "编辑文件",
  list_files: "列出文件",
  search_files: "搜索文件",
  make_directory: "创建目录",
  run_command: "运行命令",
  command_task: "查看后台命令",
  read_command_output: "读取命令输出",
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
  create_plan: "创建计划",
  spawn_agent: "委派子任务",
  wait_agents: "等待子任务",
  get_agent_result: "查看子任务结果",
  send_agent_message: "向子代理发送指令",
  resolve_agent: "确认子任务解决",
  cancel_agent: "取消子代理",
  list_agents: "查看子代理列表",
  mcp_list_tools: "列出 MCP 工具",
  mcp_call_tool: "调用 MCP 工具",
  project_context: "读取项目上下文",
  load_skill: "加载技能",
  publish_file: "发布文件",
  web_fetch: "抓取网页",
  history_search: "搜索历史记录",
  history_read: "读取历史记录",
  list_models: "列出模型",
  update_memory: "更新记忆",
  del_memory: "删除记忆",
  get_memory: "查看记忆",
  search_memory: "搜索记忆",
  forge_memory: "整理记忆",
};

export function friendlyLabel(name: string): string {
  const known = friendlyLabels[name];
  if (known) return known;
  if (name.startsWith("mcp_")) return "MCP 工具";
  return "工具调用";
}

/** One glyph per action family, so a long transcript is scannable by shape. */
export function getToolIcon(name: string) {
  if (name === "read_file") return <FileText size={16} weight="regular" />;
  if (name === "write_file" || name === "append_file") return <FilePlus size={16} weight="regular" />;
  if (name === "edit_file") return <PencilSimple size={16} weight="regular" />;
  if (name === "make_directory")
    return <FolderPlus size={16} weight="regular" />;
  if (name === "list_files") return <ListBullets size={16} weight="regular" />;
  if (name === "search_files")
    return <MagnifyingGlass size={16} weight="regular" />;
  if (name === "create_plan" || name === "update_plan") return <ListChecks size={16} weight="regular" />;
  if (
    name === "run_command" ||
    name === "command_task" ||
    name === "read_command_output"
  ) {
    return <TerminalWindow size={16} weight="regular" />;
  }
  if (
    name === "spawn_agent" ||
    name === "wait_agents" ||
    name === "get_agent_result" ||
    name === "list_agents" ||
    name === "cancel_agent"
  ) {
    return <Robot size={16} weight="regular" />;
  }
  if (name === "send_agent_message") {
    return <PaperPlaneTilt size={16} weight="regular" />;
  }
  if (name === "resolve_agent") {
    return <ShieldCheck size={16} weight="regular" />;
  }
  if (name.startsWith("git_")) return <GitDiff size={16} weight="regular" />;
  if (name.startsWith("browser_")) return <Globe size={16} weight="regular" />;
  if (name.startsWith("mcp_"))
    return <PuzzlePiece size={16} weight="regular" />;
  // Named families come before the generic "…file…" fallback, which would
  // otherwise swallow publish_file and label it as a plain file read.
  if (name === "project_context") {
    return <FolderOpen size={16} weight="regular" />;
  }
  if (name === "load_skill") return <PuzzlePiece size={16} weight="regular" />;
  if (name === "publish_file")
    return <PaperPlaneTilt size={16} weight="regular" />;
  if (name === "web_fetch") return <Globe size={16} weight="regular" />;
  if (name === "list_models") return <Cpu size={16} weight="regular" />;
  if (name.startsWith("history_"))
    return <ListNumbers size={16} weight="regular" />;
  if (name.endsWith("_memory"))
    return <HardDrive size={16} weight="regular" />;
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
  explanation: "计划说明",
  steps: "计划步骤",
};

export interface PlanStepItem {
  readonly step: string;
  readonly status: "pending" | "in_progress" | "completed";
}

export interface PlanItemData {
  /** Optional in tool arguments written before independent plans existed. */
  readonly id?: string;
  readonly title?: string;
  readonly explanation?: string;
  readonly steps: readonly PlanStepItem[];
}

function isPlanSteps(data: unknown): data is readonly PlanStepItem[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof item.step === "string" &&
      (item.status === "pending" ||
        item.status === "in_progress" ||
        item.status === "completed"),
  );
}

export function extractPlanData(data: unknown): PlanItemData | null {
  if (!data) return null;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const steps = record.steps;
  if (!isPlanSteps(steps)) return null;
  const explanation =
    typeof record.explanation === "string" ? record.explanation : undefined;
  const id = typeof record.id === "string" ? record.id : undefined;
  const title = typeof record.title === "string" ? record.title : undefined;
  return { id, title, explanation, steps };
}

export function PlanStepsList({ steps }: { readonly steps: readonly PlanStepItem[] }) {
  return (
    <ol className="tool-plan-steps">
      {steps.map((item, idx) => {
        const isCompleted = item.status === "completed";
        const isInProgress = item.status === "in_progress";
        return (
          <li
            key={idx}
            className={`tool-plan-step tool-plan-step-${item.status}`}
          >
            <span className="tool-plan-step-icon" aria-hidden="true">
              {isCompleted ? (
                <CheckCircle size={15} weight="fill" className="step-icon-completed" />
              ) : isInProgress ? (
                <CircleDashed size={15} weight="bold" className="step-icon-in-progress" />
              ) : (
                <Circle size={15} weight="regular" className="step-icon-pending" />
              )}
            </span>
            <span className="tool-plan-step-num">{idx + 1}.</span>
            <span className="tool-plan-step-text">{item.step}</span>
            <span className={`tool-plan-step-status status-${item.status}`}>
              {isCompleted ? "已完成" : isInProgress ? "进行中" : "待处理"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PlanView({ plan }: { readonly plan: PlanItemData }) {
  const completed = plan.steps.filter((s) => s.status === "completed").length;
  const total = plan.steps.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="tool-plan-view">
      <div className="tool-plan-header">
        {plan.title && <strong title={plan.id}>{plan.title}</strong>}
        <div className="tool-plan-progress-info">
          <span className="tool-plan-progress-tag">
            计划进度 {completed} / {total} 项完成
          </span>
          <span className="tool-plan-progress-percent">{percent}%</span>
        </div>
        <div className="tool-plan-progress-track">
          <div
            className="tool-plan-progress-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        {plan.explanation && (
          <div className="tool-plan-explanation">
            <span className="tool-plan-explanation-label">说明：</span>
            <span>{plan.explanation}</span>
          </div>
        )}
      </div>
      <PlanStepsList steps={plan.steps} />
    </div>
  );
}

function formatTokens(count?: number): string {
  if (count === undefined || count === null) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${count}`;
}

interface SpawnAgentParams {
  readonly task?: string;
  readonly ownership?: string;
  readonly model?: string;
  readonly writePaths?: readonly string[];
  readonly maxToolCalls?: number;
  readonly isolation?: "shared" | "worktree";
}

function SpawnAgentView({
  params,
  result,
}: {
  readonly params: SpawnAgentParams | null;
  readonly result: unknown;
}) {
  const resultRecord =
    result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  const childSessionId =
    typeof resultRecord?.childSessionId === "string"
      ? resultRecord.childSessionId
      : undefined;
  const model =
    params?.model ||
    (typeof resultRecord?.model === "string" ? resultRecord.model : undefined);
  const isolation =
    params?.isolation ||
    (typeof resultRecord?.isolation === "string"
      ? (resultRecord.isolation as "shared" | "worktree")
      : undefined);
  const workspace =
    typeof resultRecord?.workspace === "string"
      ? resultRecord.workspace
      : undefined;
  const task = params?.task;
  const ownership = params?.ownership;
  const writePaths = params?.writePaths;

  return (
    <div className="agent-card-view">
      <div className="agent-meta-bar">
        {model && (
          <span className="agent-meta-chip agent-model-chip">
            <Cpu size={13} weight="bold" />
            <span>{model}</span>
          </span>
        )}
        {ownership && (
          <span className="agent-meta-chip agent-ownership-chip">
            <ShieldCheck size={13} weight="bold" />
            <span>{ownership}</span>
          </span>
        )}
        {childSessionId && (
          <span className="agent-meta-chip agent-id-chip" title={childSessionId}>
            <span>子会话 {childSessionId.slice(0, 8)}</span>
          </span>
        )}
        {isolation && isolation !== "shared" && (
          <span className="agent-meta-chip agent-isolation-chip" title={`隔离模式：${isolation}`}>
            <span>隔离：{isolation}</span>
          </span>
        )}
        {workspace && (
          <span className="agent-meta-chip agent-workspace-chip" title={`工作区：${workspace}`}>
            <span>工作区：{workspace}</span>
          </span>
        )}
        {params?.maxToolCalls !== undefined && (
          <span className="agent-meta-chip agent-budget-chip">
            <span>预算上限 {params.maxToolCalls} 次</span>
          </span>
        )}
      </div>

      {writePaths && writePaths.length > 0 && (
        <div className="agent-paths-section">
          <span className="agent-paths-title">写入权限范围：</span>
          <div className="agent-paths-list">
            {writePaths.map((path) => (
              <code key={path} className="agent-path-tag">
                {path}
              </code>
            ))}
          </div>
        </div>
      )}

      {task && (
        <div className="agent-task-section">
          <div className="agent-task-header">
            <span className="agent-section-title">任务要求</span>
            <ToolCopyButton text={task} label="复制任务" />
          </div>
          <pre className="agent-task-content">{task}</pre>
        </div>
      )}
    </div>
  );
}

interface ChildAgentReportItem {
  readonly id: string;
  readonly status: "running" | "completed" | "failed" | "cancelled" | string;
  readonly model?: string;
  readonly summary?: string;
  readonly content?: string;
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  };
  readonly error?: string;
  readonly workspace?: string;
  readonly worktree?: {
    readonly repository: string;
    readonly worktree: string;
    readonly baseRevision: string;
  };
}

function parseWaitAgentsResult(data: unknown): readonly ChildAgentReportItem[] | null {
  if (!data) return null;
  let parsed = data;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const items: ChildAgentReportItem[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") {
      const rec = item as Record<string, unknown>;
      const worktree =
        rec.worktree && typeof rec.worktree === "object"
          ? (rec.worktree as NonNullable<ChildAgentReportItem["worktree"]>)
          : undefined;
      items.push({
        id: rec.id as string,
        status: typeof rec.status === "string" ? rec.status : "completed",
        ...(typeof rec.model === "string" ? { model: rec.model } : {}),
        ...(typeof rec.summary === "string" ? { summary: rec.summary } : {}),
        ...(typeof rec.content === "string" ? { content: rec.content } : {}),
        ...(rec.usage && typeof rec.usage === "object"
          ? { usage: rec.usage as NonNullable<ChildAgentReportItem["usage"]> }
          : {}),
        ...(typeof rec.error === "string" ? { error: rec.error } : {}),
        ...(typeof rec.workspace === "string" ? { workspace: rec.workspace } : {}),
        ...(worktree ? { worktree } : {}),
      });
    }
  }
  return items.length > 0 ? items : null;
}

function WaitAgentsView({ reports }: { readonly reports: readonly ChildAgentReportItem[] }) {
  return (
    <div className="agent-reports-view">
      {reports.map((report) => {
        const isCompleted = report.status === "completed";
        const isRunning = report.status === "running";
        const isFailed = report.status === "failed";
        const rawText = report.summary || report.content;
        const isPlaceholder = isRunning && rawText === "No terminal snapshot";
        const text = isPlaceholder ? "子任务正在后台自主执行中，等待完成交付…" : rawText;
        return (
          <div key={report.id} className={`agent-report-card status-${report.status}`}>
            <div className="agent-report-header">
              <div className="agent-report-status-wrap">
                <span className={`agent-status-tag status-${report.status}`}>
                  {isCompleted ? (
                    <CheckCircle size={13} weight="fill" />
                  ) : isRunning ? (
                    <CircleDashed size={13} weight="bold" />
                  ) : (
                    <WarningCircle size={13} weight="fill" />
                  )}
                  <span>
                    {isCompleted ? "已完成" : isRunning ? "执行中" : isFailed ? "失败" : "已取消"}
                  </span>
                </span>
                {report.model && <span className="agent-model-name">{report.model}</span>}
                <code className="agent-short-id" title={report.id}>
                  {report.id.slice(0, 8)}
                </code>
              </div>
              <div className="agent-report-meta">
                {report.usage && (
                  <span className="agent-usage-tag" title="Token 消耗">
                    <Coins size={12} weight="regular" />
                    <span>
                      {formatTokens(report.usage.promptTokens)} 入 / {formatTokens(report.usage.completionTokens)} 出
                    </span>
                  </span>
                )}
                {text && !isPlaceholder && <ToolCopyButton text={text} label="复制报告" />}
              </div>
            </div>

            {report.error && (
              <div className="agent-error-box">
                <WarningCircle size={14} weight="fill" />
                <span>{report.error}</span>
              </div>
            )}

            {report.worktree && (
              <div className="agent-paths-section">
                <span className="agent-paths-title">工作树：</span>
                <code
                  className="agent-path-tag"
                  title={`仓库：${report.worktree.repository}\n基线：${report.worktree.baseRevision}`}
                >
                  {report.worktree.worktree}
                </code>
              </div>
            )}

            {text && (
              <div className="agent-summary-body">
                <pre className={`agent-summary-content ${isPlaceholder ? "is-placeholder" : ""}`}>{text}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface CommandTaskItem {
  readonly id: string;
  readonly status: string;
  readonly title?: string;
  readonly exitCode?: number;
  readonly exit_code?: number;
  readonly duration_ms?: number;
  readonly output_available?: boolean;
}

function CommandTaskListView({
  tasks,
  pendingIds,
}: {
  readonly tasks: readonly CommandTaskItem[];
  readonly pendingIds?: readonly string[];
}) {
  if (tasks.length === 0) {
    return <span className="tool-section-empty">暂无后台任务</span>;
  }
  return (
    <div className="command-tasks-view">
      {tasks.map((task) => {
        const isCompleted = task.status === "completed";
        const isRunning =
          task.status === "running" ||
          task.status === "starting" ||
          pendingIds?.includes(task.id);
        const isFailed = task.status === "failed";
        const exit = task.exitCode ?? task.exit_code;
        return (
          <div
            key={task.id}
            className={`command-task-card status-${task.status}`}
          >
            <div className="command-task-main">
              <span className={`command-task-badge status-${task.status}`}>
                {isCompleted ? (
                  <CheckCircle size={12} weight="fill" />
                ) : isRunning ? (
                  <CircleDashed size={12} weight="bold" />
                ) : (
                  <WarningCircle size={12} weight="fill" />
                )}
                <span>
                  {isCompleted
                    ? "已完成"
                    : isRunning
                      ? "执行中"
                      : isFailed
                        ? "失败"
                        : "已终止"}
                </span>
              </span>
              <code className="command-task-id" title={task.id}>
                #{task.id.slice(0, 8)}
              </code>
              {task.title && (
                <span className="command-task-title">{task.title}</span>
              )}
            </div>
            <div className="command-task-meta">
              {exit !== undefined && (
                <span
                  className={`tool-exit tool-exit-${exit === 0 ? "ok" : "bad"}`}
                >
                  退出码 {exit}
                </span>
              )}
              {typeof task.duration_ms === "number" && (
                <span className="command-task-duration">
                  {formatDuration(task.duration_ms)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SendAgentMessageView({
  id,
  message,
}: {
  readonly id?: string;
  readonly message?: string;
}) {
  return (
    <div className="agent-message-view">
      {id && (
        <div className="agent-meta-chip agent-id-chip">
          <span>目标子会话：</span>
          <code className="agent-short-id">{id}</code>
        </div>
      )}
      {message && (
        <div className="agent-message-box">
          <div className="agent-message-label">
            <PaperPlaneTilt size={13} weight="bold" />
            <span>指派指令</span>
          </div>
          <pre className="agent-message-content">{message}</pre>
        </div>
      )}
    </div>
  );
}

function ResolveAgentView({
  id,
  resolution,
}: {
  readonly id?: string;
  readonly resolution?: string;
}) {
  return (
    <div className="agent-resolve-view">
      {id && (
        <div className="agent-meta-chip agent-id-chip">
          <span>处理子会话：</span>
          <code className="agent-short-id">{id}</code>
        </div>
      )}
      {resolution && (
        <div className="agent-resolve-box">
          <div className="agent-resolve-label">
            <ShieldCheck size={14} weight="bold" />
            <span>解决依据与说明</span>
          </div>
          <pre className="agent-resolve-content">{resolution}</pre>
        </div>
      )}
    </div>
  );
}

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
    if (isPlanSteps(value))
      return {
        block: true,
        node: <PlanStepsList steps={value} />,
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
  // Internal protocol & pagination fields for background command tasks:
  "id",
  "status",
  "output_available",
  "output_id",
  "output_notice",
  "preview_truncated",
  "result_is_error",
  "offset",
  "offset_units",
  "total_chars",
  "next_offset",
  "action",
  "background",
  "tasks",
  "pending_ids",
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

  // If a command_task's output payload is itself a JSON string representing
  // the command's completed envelope ({ stdout, stderr, exit_code, ... }),
  // unwrap it so the console displays genuine lines instead of escaped JSON.
  let innerRecord: Record<string, unknown> | null = null;
  if (typeof record.output === "string") {
    try {
      const parsedInner: unknown = JSON.parse(record.output);
      if (
        typeof parsedInner === "object" &&
        parsedInner !== null &&
        !Array.isArray(parsedInner)
      ) {
        innerRecord = parsedInner as Record<string, unknown>;
      }
    } catch {
      // Plain text output
    }
  }

  const stringField = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : null;
  const numberField = (key: string) => {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const innerStringField = (key: string) =>
    innerRecord && typeof innerRecord[key] === "string"
      ? (innerRecord[key] as string)
      : null;
  const innerNumberField = (key: string) => {
    if (!innerRecord) return null;
    const value = innerRecord[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  let body: string | null = null;
  if (innerRecord) {
    const stdout = innerStringField("stdout");
    const out = innerStringField("output");
    const err = innerStringField("error");
    if (stdout !== null) {
      body = stdout;
    } else if (out !== null) {
      body = out;
    } else if (err !== null) {
      body = null;
    } else {
      body = stringField("output") ?? null;
    }
  } else {
    body =
      consoleBodyKeys
        .map((key) => stringField(key))
        .find((value) => value !== null) ?? null;
  }

  const stderr = innerStringField("stderr") ?? stringField("stderr");
  const error = innerStringField("error") ?? stringField("error");
  const exitCode = innerNumberField("exit_code") ?? numberField("exit_code");

  const pending =
    record.output_available === false || innerRecord?.output_available === false;

  const notices: string[] = [];
  const timedOut = record.timed_out === true || innerRecord?.timed_out === true;
  if (timedOut) notices.push("命令超时后已被终止。");
  const spawnFailed =
    record.spawn_failed === true || innerRecord?.spawn_failed === true;
  if (spawnFailed) notices.push("进程未能启动。");
  const signal = innerStringField("signal") ?? stringField("signal");
  if (signal) notices.push(`命令被信号 ${signal} 终止。`);
  if (
    record.output_truncated === true ||
    innerRecord?.output_truncated === true
  )
    notices.push("原始输出已在上限处截断。");
  if (record.truncated === true)
    notices.push(
      toolName === "command_task"
        ? "这是分页结果，还有更多输出可继续读取。"
        : "输出超出采集上限，已停止采集。",
    );
  else if (
    innerRecord?.truncated === true ||
    innerRecord?.preview_truncated === true
  )
    notices.push("输出超出采集上限，已停止采集。");

  const facts: ConsoleFact[] = [];
  const duration =
    innerNumberField("duration_ms") ?? numberField("duration_ms");
  if (duration !== null)
    facts.push({
      label: paramLabels.duration_ms ?? "进程耗时",
      value: formatDuration(duration),
    });

  const taskId = stringField("id");
  if (taskId && toolName === "command_task") {
    facts.push({
      label: "任务标识",
      value: `#${taskId.slice(0, 8)}`,
    });
  }

  for (const [key, value] of Object.entries(record)) {
    if (facts.length >= 8) break;
    if (consoleConsumedKeys.has(key)) continue;
    const fact = scalarFact(value);
    if (fact === null) continue;
    facts.push({ label: paramLabels[key] ?? key, value: fact });
  }

  return {
    body,
    stderr,
    error,
    exitCode,
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

function formatBytes(bytes?: number): string | null {
  if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function formatLineRange(record: Record<string, unknown>): string | null {
  const linesReturned =
    typeof record.lines_returned === "number" ? record.lines_returned : undefined;
  const totalLines =
    typeof record.total_lines === "number" ? record.total_lines : undefined;
  const offset = typeof record.offset === "number" ? record.offset : 0;
  const endLine =
    typeof record.end_line === "number" && record.end_line !== null
      ? record.end_line
      : undefined;

  if (linesReturned === undefined && totalLines === undefined) return null;

  if (
    linesReturned !== undefined &&
    totalLines !== undefined &&
    totalLines > linesReturned
  ) {
    const start = linesReturned > 0 ? offset + 1 : 0;
    const end = endLine ?? (offset + linesReturned);
    return `第 ${start}–${end} 行 / 共 ${totalLines} 行`;
  }

  const count = totalLines ?? linesReturned;
  return count !== undefined ? `共 ${count} 行` : null;
}

function ReadFileResultView({
  record,
  isWaiting,
}: {
  readonly record: Record<string, unknown>;
  readonly isWaiting: boolean;
}) {
  const content =
    typeof record.content === "string" ? record.content : undefined;
  const unchanged = record.unchanged === true;
  const lineText = formatLineRange(record);
  const sizeText =
    typeof record.size_bytes === "number"
      ? formatBytes(record.size_bytes)
      : null;
  const cacheHit = record.cache_hit === true;
  const truncated = record.truncated === true;

  if (isWaiting && content === undefined && !unchanged) {
    return (
      <div className="tool-section">
        <SectionHead title="文件内容" />
        <span className="tool-section-empty">等待文件读取…</span>
      </div>
    );
  }

  return (
    <div className="tool-section tool-read-section">
      <SectionHead
        title="文件内容"
        action={
          content ? (
            <ToolCopyButton text={content} label="复制内容" />
          ) : undefined
        }
      />
      {(lineText || sizeText || cacheHit || truncated) && (
        <div className="tool-read-meta">
          {lineText && (
            <span className="tool-read-badge" title="读取行数范围">
              <ListNumbers size={12} weight="bold" aria-hidden="true" />
              <span>{lineText}</span>
            </span>
          )}
          {sizeText && (
            <span className="tool-read-badge" title="文件大小">
              <HardDrive size={12} weight="regular" aria-hidden="true" />
              <span>{sizeText}</span>
            </span>
          )}
          {cacheHit && (
            <span
              className="tool-read-badge tool-read-badge-cache"
              title="已从本地缓存命中"
            >
              <Lightning size={12} weight="fill" aria-hidden="true" />
              <span>缓存命中</span>
            </span>
          )}
          {truncated && (
            <span
              className="tool-read-badge tool-read-badge-warn"
              title="内容超出单次读取上限已截断"
            >
              <WarningCircle size={12} weight="fill" aria-hidden="true" />
              <span>已截断</span>
            </span>
          )}
        </div>
      )}

      {unchanged ? (
        <div className="tool-read-unchanged">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          <span>文件内容未变更（与当前缓存一致）</span>
        </div>
      ) : content !== undefined ? (
        <pre className="tool-param-block">{content}</pre>
      ) : (
        <span className="tool-section-empty">文件无内容</span>
      )}
    </div>
  );
}

function splitPath(fullPath: string): { readonly dir: string; readonly name: string } {
  const normalized = fullPath.replace(/\\/g, "/");
  const trimmed =
    normalized.endsWith("/") && normalized.length > 1
      ? normalized.slice(0, -1)
      : normalized;
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: "", name: normalized };
  }
  return {
    dir: normalized.slice(0, lastSlash + 1),
    name: normalized.slice(lastSlash + 1),
  };
}

function FileCopyButton({ path }: { readonly path: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(path);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard unavailable
      }
    },
    [path],
  );

  return (
    <button
      type="button"
      className={`tool-file-copy-btn${copied ? " is-copied" : ""}`}
      onClick={copy}
      aria-label={copied ? "已复制路径" : "复制路径"}
      title={copied ? "已复制路径" : "复制路径"}
    >
      {copied ? (
        <Check size={12} weight="bold" aria-hidden="true" />
      ) : (
        <Copy size={12} aria-hidden="true" />
      )}
    </button>
  );
}

function FileItemRow({
  entry,
}: {
  readonly entry: { readonly path: string; readonly kind?: string };
}) {
  const isDir = entry.kind === "directory" || entry.path.endsWith("/");
  const { dir, name } = splitPath(entry.path);

  return (
    <li className={`tool-file-item ${isDir ? "is-dir" : "is-file"}`}>
      <span className="tool-file-icon" aria-hidden="true">
        {isDir ? (
          <Folder size={14} weight="fill" className="file-icon-dir" />
        ) : (
          <FileText size={14} weight="regular" className="file-icon-file" />
        )}
      </span>
      <span className="tool-file-path" title={entry.path}>
        {dir && <span className="tool-file-dir">{dir}</span>}
        <span className="tool-file-name">{name || entry.path}</span>
      </span>
      <span className="tool-file-actions">
        {isDir && <span className="tool-file-type-badge">目录</span>}
        <FileCopyButton path={entry.path} />
      </span>
    </li>
  );
}

function ListFilesResultView({
  record,
  parameters,
  isWaiting,
}: {
  readonly record: Record<string, unknown>;
  readonly parameters?: unknown;
  readonly isWaiting: boolean;
}) {
  if (isWaiting && (!record || !Array.isArray(record.entries))) {
    return (
      <div className="tool-section tool-file-list-section">
        <SectionHead title="文件列表" />
        <span className="tool-section-empty">等待文件列表…</span>
      </div>
    );
  }

  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const entries: readonly { readonly path: string; readonly kind?: string }[] =
    rawEntries.map((e) => {
      if (typeof e === "string") return { path: e, kind: "file" };
      if (
        e &&
        typeof e === "object" &&
        typeof (e as Record<string, unknown>).path === "string"
      ) {
        const rec = e as Record<string, unknown>;
        return {
          path: rec.path as string,
          kind: typeof rec.kind === "string" ? rec.kind : "file",
        };
      }
      return { path: String(e), kind: "file" };
    });

  const parsedParams =
    typeof parameters === "object" &&
    parameters !== null &&
    !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : undefined;

  const glob =
    typeof parsedParams?.glob === "string" ? parsedParams.glob : undefined;
  const isRecursive = parsedParams?.recursive === true;

  const offset = typeof record.offset === "number" ? record.offset : 0;
  const nextOffset =
    typeof record.next_offset === "number" ? record.next_offset : null;
  const truncated = record.truncated === true;
  const scanTruncated = record.scan_truncated === true;

  const dirCount = entries.filter((e) => e.kind === "directory").length;
  const fileCount = entries.length - dirCount;

  const summaryCount =
    entries.length === 0
      ? "0 个项目"
      : dirCount > 0 && fileCount > 0
        ? `${fileCount} 个文件 · ${dirCount} 个目录`
        : dirCount > 0
          ? `${dirCount} 个目录`
          : `${fileCount} 个文件`;

  const allPathsText = entries.map((e) => e.path).join("\n");

  return (
    <div className="tool-section tool-file-list-section">
      <SectionHead
        title="文件列表"
        action={
          entries.length > 0 ? (
            <ToolCopyButton text={allPathsText} label="复制全部路径" />
          ) : undefined
        }
      />

      <div className="tool-read-meta tool-file-meta">
        <span className="tool-read-badge" title="项目总数">
          <ListBullets size={12} weight="bold" aria-hidden="true" />
          <span>{summaryCount}</span>
        </span>

        {glob && (
          <span className="tool-read-badge" title={`匹配模式：${glob}`}>
            <Funnel size={12} weight="fill" aria-hidden="true" />
            <span>{glob}</span>
          </span>
        )}

        {isRecursive && (
          <span className="tool-read-badge" title="已递归遍历子目录">
            <span>递归</span>
          </span>
        )}

        {offset > 0 && (
          <span className="tool-read-badge" title={`当前起始偏移：${offset}`}>
            <span>偏移 {offset}</span>
          </span>
        )}

        {(truncated || nextOffset !== null) && (
          <span
            className="tool-read-badge tool-read-badge-warn"
            title="条目过多，当前仅返回部分结果"
          >
            <WarningCircle size={12} weight="fill" aria-hidden="true" />
            <span>已截断{nextOffset !== null ? ` (下一页: ${nextOffset})` : ""}</span>
          </span>
        )}

        {scanTruncated && (
          <span
            className="tool-read-badge tool-read-badge-warn"
            title="目录层级或文件量过大，扫描在达到上限时提前终止"
          >
            <WarningCircle size={12} weight="fill" aria-hidden="true" />
            <span>扫描超出上限</span>
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="tool-file-empty">
          <FolderOpen size={20} weight="regular" aria-hidden="true" />
          <span>无匹配文件</span>
        </div>
      ) : (
        <div className="tool-file-list-container">
          <ul className="tool-file-list">
            {entries.map((entry, idx) => (
              <FileItemRow key={`${entry.path}-${idx}`} entry={entry} />
            ))}
          </ul>
        </div>
      )}
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
  const writesFiles = ["edit_file", "write_file", "append_file"].includes(toolName);
  // A plain command's arguments are its command line (shown in the console); a
  // background task's arguments are the only record of the requested action.
  const isRunCommand = toolName === "run_command";
  const isCommandTask = toolName === "command_task";
  const parsedOutputRecord = (() => {
    if (typeof output !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(output);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();
  const isCommandTaskList =
    isCommandTask && Array.isArray(parsedOutputRecord?.tasks);
  const isConsole = isRunCommand || (isCommandTask && !isCommandTaskList);
  const isWaiting = status === "running";
  // File modifications and failed tools open by default. Read-only queries and
  // terminal commands default to collapsed quiet rows from start to finish,
  // preventing jarring momentary expand/collapse jitter as fast tools complete.
  const initialExpanded =
    defaultExpanded !== undefined
      ? defaultExpanded
      : writesFiles || status === "failed";
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
  const isReadFile = toolName === "read_file";
  const isListFiles = toolName === "list_files";
  const readPath =
    isReadFile ? parameterPath || target : undefined;
  const consoleModel = isConsole
    ? decodeCommandConsole(output, toolName)
    : null;
  const result =
    !isConsole && output !== null && output !== undefined && output !== ""
      ? parseResult(output)
      : null;
  const planData =
    extractPlanData(result?.kind === "object" ? result.record : output) ??
    extractPlanData(parsedParams);
  const planSummaryTarget =
    !target && planData
      ? (() => {
          const completed = planData.steps.filter((s) => s.status === "completed").length;
          const total = planData.steps.length;
          const inProgress = planData.steps.find((s) => s.status === "in_progress");
          if (inProgress) return `(${completed}/${total}) ${inProgress.step}`;
          if (planData.explanation) return `(${completed}/${total}) ${planData.explanation}`;
          return `${completed}/${total} 步已完成`;
        })()
      : undefined;

  const isSpawnAgent = toolName === "spawn_agent";
  const isWaitAgents = toolName === "wait_agents";
  const isGetAgentResult = toolName === "get_agent_result";
  const isSendMessage = toolName === "send_agent_message";
  const isResolveAgent = toolName === "resolve_agent";
  const isAgentTool =
    isSpawnAgent ||
    isWaitAgents ||
    isGetAgentResult ||
    isSendMessage ||
    isResolveAgent;

  const agentParamsRecord =
    typeof parsedParams === "object" && parsedParams !== null
      ? (parsedParams as Record<string, unknown>)
      : null;

  const agentTarget =
    !target && isAgentTool && agentParamsRecord
      ? (() => {
          if (isSpawnAgent) {
            if (typeof agentParamsRecord.ownership === "string")
              return agentParamsRecord.ownership;
            if (typeof agentParamsRecord.task === "string")
              return agentParamsRecord.task.split("\n")[0].slice(0, 70);
            if (typeof agentParamsRecord.model === "string")
              return agentParamsRecord.model;
          }
          if (isWaitAgents) {
            const ids = agentParamsRecord.ids;
            if (Array.isArray(ids) && ids.length > 0)
              return `${ids.length} 个子任务`;
            return "全部当前子任务";
          }
          if (isGetAgentResult && typeof agentParamsRecord.id === "string") {
            return `子代理 ${agentParamsRecord.id.slice(0, 8)}...`;
          }
          if (isSendMessage && typeof agentParamsRecord.message === "string") {
            return agentParamsRecord.message.split("\n")[0].slice(0, 60);
          }
          if (isResolveAgent && typeof agentParamsRecord.resolution === "string") {
            return agentParamsRecord.resolution.split("\n")[0].slice(0, 60);
          }
          return undefined;
        })()
      : undefined;

  const commandTaskTarget =
    isCommandTask && parsedParams && typeof parsedParams === "object"
      ? (() => {
          const rec = parsedParams as Record<string, unknown>;
          const action = typeof rec.action === "string" ? rec.action : "";
          const id = typeof rec.id === "string" ? rec.id : "";
          const actionText =
            action === "wait"
              ? "等待完成"
              : action === "read"
                ? "读取输出"
                : action === "stop"
                  ? "终止任务"
                  : action === "list"
                    ? "任务列表"
                    : action;
          const shortId = id ? `#${id.slice(0, 8)}` : "";
          return [actionText, shortId].filter(Boolean).join(" · ") || undefined;
        })()
      : undefined;

  const normalizedTarget =
    isCommandTask &&
    target &&
    typeof parsedParams === "object" &&
    parsedParams !== null &&
    "id" in parsedParams &&
    parsedParams.id === target
      ? commandTaskTarget || `#${target.slice(0, 8)}`
      : target;

  const displayTarget = readPath
    ? readPath.split(/[\\/]/).pop() || readPath
    : normalizedTarget || commandTaskTarget || planSummaryTarget || agentTarget || (isRunCommand ? command : undefined);
  const showParameters =
    !writesFiles && !isRunCommand && !isCommandTask && !planData && !isAgentTool && !isReadFile;
  const showDebug = !isReadFile;

  useEffect(() => {
    if (
      defaultExpanded !== undefined ||
      manuallyToggled.current ||
      autoCollapsed
    )
      return;
    // Auto-reveal on failure so errors are prominently displayed. Never
    // auto-collapse tools upon completion (which caused sudden collapse jumps).
    if (status === "failed") {
      setExpanded(true);
    }
  }, [status, defaultExpanded, autoCollapsed]);

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
  const canShowReadFile =
    isReadFile &&
    result?.kind === "object" &&
    (status !== "failed" || !failureReason);
  const isListFilesResult =
    isListFiles &&
    result?.kind === "object" &&
    Array.isArray(result.record.entries);
  const canShowListFiles =
    (isListFilesResult || (isListFiles && isWaiting && !result)) &&
    (status !== "failed" || !failureReason);

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

      <Collapsible open={expanded} id={detailsId}>
        <div className="tool-disclosure-body">
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
              {planData ? (
                <div className="tool-section tool-plan-section">
                  <SectionHead title="计划进度" />
                  <PlanView plan={planData} />
                </div>
              ) : isCommandTaskList ? (
                <div className="tool-section tool-command-tasks-section">
                  <SectionHead title="后台任务列表" />
                  <CommandTaskListView
                    tasks={
                      (parsedOutputRecord?.tasks as unknown as readonly CommandTaskItem[]) ??
                      []
                    }
                    pendingIds={
                      parsedOutputRecord?.pending_ids as
                        | readonly string[]
                        | undefined
                    }
                  />
                </div>
              ) : isSpawnAgent ? (
                <div className="tool-section tool-agent-section">
                  <SectionHead title="子任务委派" />
                  <SpawnAgentView
                    params={agentParamsRecord as SpawnAgentParams}
                    result={
                      result?.kind === "object"
                        ? result.record
                        : parseParams(output)
                    }
                  />
                </div>
              ) : isWaitAgents ? (
                <div className="tool-section tool-agent-section">
                  <SectionHead title="子任务执行进展" />
                  {(() => {
                    const reports = parseWaitAgentsResult(
                      result?.kind === "object" ? result.record : output,
                    );
                    return reports ? (
                      <WaitAgentsView reports={reports} />
                    ) : (
                      <span className="tool-section-empty">
                        {isWaiting ? "等待子任务返回…" : "无子任务状态记录"}
                      </span>
                    );
                  })()}
                </div>
              ) : isGetAgentResult ? (
                <div className="tool-section tool-agent-section">
                  <SectionHead title="子任务报告详情" />
                  {(() => {
                    const parsed =
                      result?.kind === "object"
                        ? result.record
                        : parseParams(output);
                    const reports = parseWaitAgentsResult(
                      Array.isArray(parsed) ? parsed : [parsed],
                    );
                    return reports ? (
                      <WaitAgentsView reports={reports} />
                    ) : result?.kind === "text" ? (
                      <pre className="tool-section-content">{result.text}</pre>
                    ) : (
                      <span className="tool-section-empty">
                        {isWaiting ? "等待子任务返回…" : "无子任务报告"}
                      </span>
                    );
                  })()}
                </div>
              ) : isSendMessage ? (
                <div className="tool-section tool-agent-section">
                  <SectionHead title="子代理指令" />
                  <SendAgentMessageView
                    id={agentParamsRecord?.id as string}
                    message={agentParamsRecord?.message as string}
                  />
                </div>
              ) : isResolveAgent ? (
                <div className="tool-section tool-agent-section">
                  <SectionHead title="子任务解决记录" />
                  <ResolveAgentView
                    id={agentParamsRecord?.id as string}
                    resolution={agentParamsRecord?.resolution as string}
                  />
                </div>
              ) : canShowReadFile && result?.kind === "object" ? (
                <ReadFileResultView
                  record={result.record}
                  isWaiting={isWaiting}
                />
              ) : canShowListFiles ? (
                <ListFilesResultView
                  record={result?.kind === "object" ? result.record : {}}
                  parameters={parsedParams}
                  isWaiting={isWaiting}
                />
              ) : (
                (hasResult ||
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
                )
              )}
            </>
          )}

          {(showParameters || showDebug) && (
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
              {showDebug && (
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
              )}
            </div>
          )}
        </div>
      </Collapsible>
    </section>
  );
}
