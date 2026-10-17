import { configureInputSchema, type ConfigureInput, type PublicSettings } from "../../shared/schemas";

export type SettingsDraft = {
  baseUrl: string; model: string; apiMode: string; reasoningEffort: string;
  theme: string; defaultPermission: string; maxTurns: string; maxToolCalls: string;
  requestTimeoutMs: string; contextBudgetTokens: string; contextBudgetChars: string;
  browserAllowedOrigins: string; browserExecutablePath: string;
  modelContextWindows: { model: string; tokens: string }[];
  lspServers: { id: string; command: string; args: string; extensions: string }[];
};
export function createSettingsDraft(s: PublicSettings): SettingsDraft {
  return {
    baseUrl: s.baseUrl, model: s.model, apiMode: s.apiMode ?? "chat-completions",
    reasoningEffort: s.reasoningEffort ?? "default", theme: s.theme, defaultPermission: s.defaultPermission,
    maxTurns: String(s.maxTurns), maxToolCalls: String(s.maxToolCalls), requestTimeoutMs: String(s.requestTimeoutMs),
    contextBudgetTokens: s.contextBudgetTokens == null ? "" : String(s.contextBudgetTokens), contextBudgetChars: String(s.contextBudgetChars),
    browserAllowedOrigins: s.browserAllowedOrigins.join("\n"), browserExecutablePath: s.browserExecutablePath,
    modelContextWindows: Object.entries(s.modelContextWindows ?? {}).map(([model, tokens]) => ({ model, tokens: tokens == null ? "" : String(tokens) })),
    lspServers: (s.lspServers ?? []).map(server => ({ ...server, args: JSON.stringify(server.args), extensions: server.extensions.join(", ") })),
  };
}
const integer = (value: string, field: string) => {
  if (!/^\d+$/.test(value.trim())) throw Error(`${field}：请输入整数，不能留空。`);
  return Number(value);
};
/** Only send edited fields so unrelated settings changed elsewhere are not overwritten. */
export function buildSettingsUpdate(draft: SettingsDraft, original: PublicSettings, key: string, removeKey: boolean): ConfigureInput {
  if (key && removeKey) throw Error("不能同时替换和清除 API 密钥。");
  const baseline = createSettingsDraft(original);
  const settings: Record<string, unknown> = {};
  for (const name of Object.keys(draft) as (keyof SettingsDraft)[]) {
    if (JSON.stringify(draft[name]) === JSON.stringify(baseline[name])) continue;
    switch (name) {
      case "maxTurns": case "maxToolCalls": case "requestTimeoutMs": case "contextBudgetChars":
        settings[name] = integer(draft[name], name); break;
      case "contextBudgetTokens": settings[name] = draft[name].trim() ? integer(draft[name], name) : null; break;
      case "browserAllowedOrigins": settings[name] = draft[name].split("\n").map(v => v.trim()).filter(Boolean); break;
      case "modelContextWindows": {
        const entries = draft[name].map(row => [row.model.trim(), row.tokens.trim() ? integer(row.tokens, "模型窗口") : null] as const);
        if (entries.some(([model]) => !model) || new Set(entries.map(([model]) => model)).size !== entries.length) throw Error("模型窗口：模型 ID 不能为空或重复。");
        settings[name] = Object.fromEntries(entries); break;
      }
      case "lspServers": settings[name] = draft[name].map(row => {
        let args: unknown;
        try { args = JSON.parse(row.args); } catch { throw Error(`LSP ${row.id}：参数必须是 JSON 字符串数组。`); }
        return { id: row.id.trim(), command: row.command.trim(), args, extensions: row.extensions.split(",").map(v => v.trim()).filter(Boolean) };
      }); break;
      default: settings[name] = draft[name];
    }
  }
  const parsed = configureInputSchema.safeParse({ ...(Object.keys(settings).length ? { settings } : {}), ...(removeKey ? { apiKey: "" } : key ? { apiKey: key } : {}) });
  if (!parsed.success) throw Error(parsed.error.issues.map(issue => `${issue.path.join(".")}：${issue.message}`).join("\n"));
  return parsed.data;
}
