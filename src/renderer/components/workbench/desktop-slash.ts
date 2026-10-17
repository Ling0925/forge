import { createSlashActions } from "../../../shared/slash-actions";
import { parseSlashCommand, SLASH_COMMANDS } from "../../../shared/slash-commands";
import { parseSessionId, permissionSchema, settingsFields, type SessionId, type SessionSnapshot } from "../../../shared/schemas";
import type { ForgeBridge } from "../../../shared/ipc";

// Limitations of the current desktop bridge, not a second command catalog.
export const desktopSlashLimitation = (name: string): string | undefined => ({
  "/history": "仅 CLI：终端输入历史；桌面草稿不是该历史记录",
  "/approval": "仅 CLI：进程内自动审批策略；桌面保留逐项审批",
  "/tasks": "桌面桥接尚未提供进程任务查询/停止接口",
  "/tools": "CLI 工具编号视图尚未接入桌面；请使用消息中的工具卡",
  "/thinking": "CLI 流式思考展示开关尚未接入桌面；请使用思考折叠区",
  "/quit": "仅 CLI：退出进程；桌面请关闭窗口",
  "/exit": "仅 CLI：退出进程；桌面请关闭窗口",
} as Record<string, string>)[name];

export interface DesktopSlashHost {
  bridge: ForgeBridge;
  sessionId: SessionId | undefined;
  workspace: string;
  model: string;
  mode: "plan" | "build";
  permission: string;
  running: boolean;
  steer?(text: string): Promise<boolean>;
  queueCommand?(value: string): string;
  setModel(value: string): void;
  setMode(value: "plan" | "build"): void;
  setPermission(value: string): Promise<void>;
  setReasoning(value: string): Promise<boolean>;
  openModel(): void;
  applySnapshot(snapshot: SessionSnapshot, switchSession: boolean): Promise<void>;
}
export interface DesktopSlashResult {
  clearPrompt?: boolean;
  text?: string;
  sessions?: readonly { id: SessionId; title: string }[];
}
export async function executeDesktopSlash(line: string, host: DesktopSlashHost): Promise<DesktopSlashResult> {
  const { command, value, words } = parseSlashCommand(line);
  if (!SLASH_COMMANDS.some(item => item.name === command)) throw Error("Unknown or unavailable command. /help lists supported actions.");
  if (command === "/help") return { text: SLASH_COMMANDS.map(item =>
    `${item.name}${item.args ? ` ${item.args}` : ""} — ${item.description}${desktopSlashLimitation(item.name) ? ` [${desktopSlashLimitation(item.name)}]` : ""}`
  ).join("\n") };
  const limitation = desktopSlashLimitation(command);
  if (limitation) throw Error(limitation);
  if (command === "/steer") {
    if (!host.running || !value || !host.steer) throw Error("需要活动运行：/steer <消息>");
    if (!await host.steer(value)) throw Error("插话未确认写入，草稿已保留。");
    return { text: "插话已写入当前会话。", clearPrompt: true };
  }
  if (command === "/queue") {
    if (!host.queueCommand) throw Error("当前宿主不支持待发队列。");
    return { text: host.queueCommand(value), clearPrompt: true };
  }
  // Do not silently race live work or apply a deferred command to a different session.
  if (host.running) throw Error("当前会话正在运行，请停止或等待完成后执行此命令（桌面不自动排队）。");
  const actions = createSlashActions(host.bridge);
  const id = () => {
    if (!host.sessionId) throw Error("No active session. Send a message, use /new, or /resume first.");
    return host.sessionId;
  };
  const data = (result: unknown) => ({ text: JSON.stringify(result ?? null, null, 2) });
  const apply = async (snapshot: SessionSnapshot) => {
    await host.applySnapshot(snapshot, ["/new", "/fork", "/resume"].includes(command));
    return { text: `${command}: ${snapshot.id}` };
  };
  switch (command) {
    case "/model":
      if (value) host.setModel(settingsFields.model.parse(value));
      else host.openModel();
      return { text: value ? `Model: ${value}` : "选择模型" };
    case "/reasoning":
      if (!value) { host.openModel(); return { text: "在模型面板中选择思考强度" }; }
      if (!await host.setReasoning(settingsFields.reasoningEffort.unwrap().parse(value))) throw Error("思考强度保存失败，未自动重试。");
      return { text: `Reasoning: ${value}` };
    case "/mode":
      if (value && value !== "plan" && value !== "build") throw Error("Expected plan or build.");
      if (value) host.setMode(value as "plan" | "build");
      return { text: `Mode: ${value || host.mode}` };
    case "/permission":
      if (value) await host.setPermission(permissionSchema.parse(value));
      return { text: `Permission: ${value || host.permission}` };
    case "/new": return apply(await actions.newSession(host.workspace, host.model));
    case "/resume":
      if (value) return apply(await host.bridge.getSession(parseSessionId(value)));
      return { sessions: await actions.sessions(), text: "选择会话恢复" };
    case "/sessions": return { sessions: await actions.sessions(), text: "历史会话" };
    case "/fork": return apply(await actions.fork(id(), value));
    case "/rename": return apply(await actions.rename(id(), value));
    case "/archive": return apply(await actions.archive(id()));
    case "/compact": {
      const sessionId = id();
      const before = await host.bridge.getSession(sessionId);
      const snapshot = await actions.compact(sessionId);
      await host.applySnapshot(snapshot, false);
      const summary = snapshot.contextSummary;
      if (!summary || summary.boundary === before.contextSummary?.boundary)
        return { text: "没有新增可压缩内容；当前摘要保持不变。" };
      const result = snapshot.events.findLast(event => event.type === "context_compacted");
      const size = result?.type === "context_compacted"
        ? `投影上下文：${result.beforeChars} → ${result.afterChars} 字符。` : "";
      return { text: `${summary.fallback ? "已生成降级摘要（模型摘要未成功），内容可能不完整。" : "上下文压缩完成。"}${size}原始聊天记录保留，后续请求使用摘要；累计 token 用量不会清零。` };
    }
    case "/plan": return data(await actions.plan(id()));
    case "/diagnostics": return data(await actions.diagnostics(id()));
    case "/context": return data(await actions.context(id()));
    case "/skills": return data(await actions.skills(id()));
    case "/mcp": return data(await actions.mcp(words));
    case "/checkpoints": {
      const result = await actions.checkpoints(id(), words);
      if (result.kind === "snapshot") return apply(result.snapshot);
      return result.kind === "text" ? { text: result.text } : data(result.data);
    }
    case "/export": return data(await actions.export(id()));
    default: throw Error("Unknown or unavailable command. /help lists supported actions.");
  }
}
