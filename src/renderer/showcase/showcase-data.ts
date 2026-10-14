import type { FileChange } from "../shared-types";

export const SAMPLE_CODE = `// 示例只读代码（非运行时核心）
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return \`\${durationMs}ms\`;
  }
  const seconds = (durationMs / 1000).toFixed(1);
  return \`\${seconds}s\`;
}

export function parseTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return \`\${(tokens / 1000).toFixed(1)}k\`;
  }
  return tokens.toString();
}`;

export const SAMPLE_FILE_CHANGE: FileChange = {
  path: "src/utils/formatter.ts",
  kind: "modified",
  before:
    'export function formatDuration(ms: number): string {\n  return ms + "ms";\n}',
  after:
    "export function formatDuration(ms: number): string {\n  if (ms < 1000) return `${ms}ms`;\n  return `${(ms / 1000).toFixed(1)}s`;\n}",
  truncated: false,
};

export const SAMPLE_MODELS = [
  { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet (默认)" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { value: "qwen/qwen-2.5-coder-32b", label: "Qwen 2.5 Coder 32B" },
] as const;

export const SAMPLE_PERMISSIONS = [
  { value: "readonly", label: "只读 (readonly) - 仅允许读取授权范围文件" },
  {
    value: "workspace",
    label: "工作区 (workspace) - 允许文件写入，Shell需审批",
  },
  {
    value: "unrestricted",
    label: "不受限 (unrestricted) - 需显式确认扩大权限",
  },
] as const;
