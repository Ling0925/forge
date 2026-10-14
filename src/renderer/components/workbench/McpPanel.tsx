import { useCallback, useEffect, useRef, useState } from "react";
import { type McpRecordDto, mcpRegisterDtoSchema } from "../../../shared/ipc";
import { OperationScope } from "../../state/operation-scope";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Textarea } from "../primitives/Textarea";
import { Dialog } from "./Dialog";

export function McpPanel() {
  const [servers, setServers] = useState<readonly McpRecordDto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [serverId, setServerId] = useState("");
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [health, setHealth] = useState<Record<string, string>>({});
  const scope = useRef(new OperationScope());
  const report = useCallback(
    (err: unknown) => setError(err instanceof Error ? err.message : "操作失败"),
    [],
  );
  useEffect(() => {
    scope.current = new OperationScope();
    let alive = true;
    void window.forge
      .listMcpServers()
      .then((value) => {
        if (alive) setServers(value);
      })
      .catch((err) => {
        if (alive) report(err);
      });
    return () => {
      alive = false;
      scope.current.close();
    };
  }, [report]);
  const action = async (operation: (valid: () => boolean) => Promise<void>) => {
    const valid = scope.current.begin();
    setBusy(true);
    setError("");
    try {
      await operation(valid);
    } catch (err) {
      if (valid()) report(err);
    } finally {
      if (valid()) setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <section className="wb-stack">
        <h3>MCP · stdio 服务器</h3>
        <Button size="sm" disabled={busy} onClick={() => setRegistering(true)}>
          注册服务器
        </Button>
        {servers.map((server) => (
          <article key={server.id} className="agent-card wb-stack">
            <strong>
              {server.label} · {server.enabled ? "已启用" : "已禁用"}
            </strong>
            <code className="wb-wrap-anywhere">
              {JSON.stringify([server.command, ...server.args])}
            </code>
            <p className="wb-muted">
              注册不启动进程；连接测试会启动已启用的服务器，不代表活动代理连接状态。命令不是
              OS 沙箱。
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(async (valid) => {
                  await window.forge.setMcpEnabled(server.id, !server.enabled);
                  const servers = await window.forge.listMcpServers();
                  if (!valid()) return;
                  setServers(servers);
                })
              }
            >
              {server.enabled ? "禁用" : "启用"}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(async (valid) => {
                  const value = await window.forge.getMcpHealth(server.id);
                  if (!valid()) return;
                  setHealth((previous) => ({
                    ...previous,
                    [server.id]: `${value.connected ? "连接测试成功" : value.enabled ? "未连接" : "已禁用"}${value.negotiatedProtocolVersion ? ` · ${value.negotiatedProtocolVersion}` : ""}${value.lastError ? ` · ${value.lastError}` : ""}`,
                  }));
                })
              }
            >
              测试连接（启动已启用服务器）
            </Button>
            {health[server.id] && <p>{health[server.id]}</p>}
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(async (valid) => {
                  await window.forge.removeMcpServer(server.id);
                  const servers = await window.forge.listMcpServers();
                  if (!valid()) return;
                  setServers(servers);
                })
              }
            >
              移除注册
            </Button>
          </article>
        ))}
      </section>
      <Dialog
        open={registering}
        title="注册 MCP stdio 服务器"
        onClose={() => setRegistering(false)}
      >
        <form
          className="modal-content wb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            let parsedArgs: unknown;
            try {
              parsedArgs = JSON.parse(args);
            } catch {
              parsedArgs = undefined;
            }
            const parsed = mcpRegisterDtoSchema.safeParse({
              id: serverId,
              label,
              command,
              args: parsedArgs,
              enabled: false,
            });
            if (!parsed.success) {
              const next: Record<string, string> = {};
              for (const issue of parsed.error.issues) {
                const key = String(issue.path[0] ?? "args");
                next[key] ??= issue.message;
              }
              if (parsedArgs === undefined) {
                next.args = "参数必须是 JSON 字符串数组";
              }
              setFieldErrors(next);
              return;
            }
            setFieldErrors({});
            void action(async (valid) => {
              await window.forge.registerMcpServer(parsed.data);
              const servers = await window.forge.listMcpServers();
              if (!valid()) return;
              setServers(servers);
              setRegistering(false);
            });
          }}
        >
          <Field
            id="mcp-server-id"
            label="服务器 ID"
            helper="小写字母、数字、连字符，1–32 个字符。"
            error={fieldErrors.id}
          >
            <Input
              id="mcp-server-id"
              name="id"
              autoComplete="off"
              isMono
              isError={Boolean(fieldErrors.id)}
              aria-describedby={
                fieldErrors.id ? "mcp-server-id-error" : "mcp-server-id-helper"
              }
              placeholder="例如 docs-search"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
            />
          </Field>
          <Field
            id="mcp-server-name"
            label="服务器名称"
            helper="在列表中显示的名称，1–64 个字符。"
            error={fieldErrors.label}
          >
            <Input
              id="mcp-server-name"
              name="label"
              autoComplete="off"
              isError={Boolean(fieldErrors.label)}
              aria-describedby={
                fieldErrors.label
                  ? "mcp-server-name-error"
                  : "mcp-server-name-helper"
              }
              placeholder="例如 文档搜索"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field
            id="mcp-server-command"
            label="可执行命令"
            helper="本地可执行文件路径或命令名。"
            error={fieldErrors.command}
          >
            <Input
              id="mcp-server-command"
              name="command"
              autoComplete="off"
              isMono
              isError={Boolean(fieldErrors.command)}
              aria-describedby={
                fieldErrors.command
                  ? "mcp-server-command-error"
                  : "mcp-server-command-helper"
              }
              className="wb-wrap-anywhere"
              placeholder="例如 npx"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </Field>
          <Field
            id="mcp-server-args"
            label="参数 JSON 数组"
            helper='JSON 字符串数组，例如 ["-y", "pkg"]。不会导入环境变量或 API 密钥。'
            error={fieldErrors.args}
          >
            <Textarea
              id="mcp-server-args"
              name="args"
              isError={Boolean(fieldErrors.args)}
              aria-describedby={
                fieldErrors.args
                  ? "mcp-server-args-error"
                  : "mcp-server-args-helper"
              }
              className="wb-wrap-anywhere"
              spellCheck={false}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </Field>
          <p className="wb-muted">
            注册不启动进程，新服务器默认禁用，之后仍需显式启用。
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            注册（默认禁用）
          </Button>
        </form>
      </Dialog>
    </>
  );
}
