import {
  Broadcast,
  Code,
  Cpu,
  Database,
  Folder,
  Globe,
  LockKey,
  MagnifyingGlass,
  Plugs,
  Plus,
  PuzzlePiece,
  TerminalWindow,
  Trash,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type McpRecordDto, mcpRegisterDtoSchema } from "../../../shared/ipc";
import { OperationScope } from "../../state/operation-scope";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select, type SelectOption } from "../primitives/Select";
import { Textarea } from "../primitives/Textarea";
import { Dialog } from "./Dialog";
import "./mcp-panel.css";

type McpTransportType = "stdio" | "http" | "sse";

const TRANSPORT_OPTIONS: readonly SelectOption[] = [
  { value: "stdio", label: "stdio（本地进程）" },
  { value: "http", label: "Streamable HTTP" },
  { value: "sse", label: "Legacy SSE" },
];

function resolveMcpCardVisuals(server: McpRecordDto, isRemote: boolean) {
  const haystack =
    `${server.id} ${server.label} ${server.command} ${server.url ?? ""}`.toLowerCase();

  let Icon = isRemote
    ? server.transport === "sse"
      ? Broadcast
      : Globe
    : TerminalWindow;

  if (/(search|fetch|brave|exa|tavily|query|find)/.test(haystack)) {
    Icon = MagnifyingGlass;
  } else if (/(db|sql|postgres|sqlite|mysql|redis|mongo|data)/.test(haystack)) {
    Icon = Database;
  } else if (/(file|fs|folder|doc|note|path|storage)/.test(haystack)) {
    Icon = Folder;
  } else if (/(git|github|gitlab|code|lsp|repo|dev)/.test(haystack)) {
    Icon = Code;
  } else if (/(memory|brain|context|ai|agent)/.test(haystack)) {
    Icon = Cpu;
  } else if (!isRemote && !server.command) {
    Icon = PuzzlePiece;
  }

  let description: string;
  if (isRemote) {
    const mode = server.transport === "sse" ? "SSE 事件流" : "Streamable HTTP";
    description = `远程 ${mode} 工具扩展服务，注册不自动连接；测试连接会执行 MCP 握手。`;
  } else {
    const runner = server.command ? `（${server.command}）` : "";
    description = `本地进程工具服务${runner}，注册不启动进程；连接测试会启动已启用的服务器。命令不是 OS 沙箱。`;
  }

  return { Icon, description };
}

export function McpPanel() {
  const [servers, setServers] = useState<readonly McpRecordDto[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [transport, setTransport] = useState<McpTransportType>("stdio");
  const [serverId, setServerId] = useState("");
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [url, setUrl] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const [health, setHealth] = useState<Record<string, string>>({});
  const scope = useRef(new OperationScope());
  const report = useCallback(
    (err: unknown) => setError(err instanceof Error ? err.message : "操作失败"),
    [],
  );

  const resetForm = useCallback(() => {
    setTransport("stdio");
    setServerId("");
    setLabel("");
    setCommand("");
    setArgs("[]");
    setUrl("");
    setAuthorization("");
    setFieldErrors({});
  }, []);

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
      <section className="mcp-panel wb-stack">
        <div className="mcp-panel-header">
          <div className="mcp-panel-title-group">
            <h3>MCP 服务器</h3>
            <span className="mcp-panel-count">{servers.length}</span>
          </div>
        </div>
        <div className="mcp-card-grid">
          {servers.map((server) => {
            const isRemote =
              server.transport === "http" ||
              server.transport === "sse" ||
              Boolean(server.url);
            const transportLabel =
              server.transport === "http"
                ? "HTTP"
                : server.transport === "sse"
                  ? "SSE"
                  : "stdio";
            const { Icon, description } = resolveMcpCardVisuals(
              server,
              isRemote,
            );
            return (
              <article
                key={server.id}
                className={`mcp-card agent-card ${server.enabled ? "is-enabled" : "is-disabled"}`}
              >
                <div className="mcp-card-top">
                  <div className="mcp-card-icon" aria-hidden="true">
                    <Icon size={20} weight="duotone" />
                  </div>
                  <div className="mcp-card-heading">
                    <strong className="mcp-card-title">
                      <span className="mcp-card-name">{server.label}</span>
                      <span className="mcp-card-sep"> · </span>
                      <span className="mcp-card-badge mcp-card-badge-transport">
                        {transportLabel}
                      </span>
                      <span className="mcp-card-sep"> · </span>
                      <span
                        className={`mcp-card-badge mcp-card-badge-status ${
                          server.enabled ? "is-enabled" : "is-disabled"
                        }`}
                      >
                        <span
                          className="mcp-card-status-dot"
                          aria-hidden="true"
                        />
                        {server.enabled ? "已启用" : "已禁用"}
                      </span>
                    </strong>
                    <span className="mcp-card-id">{server.id}</span>
                  </div>
                </div>

                <p className="mcp-card-desc wb-muted">{description}</p>

                <div className="mcp-card-endpoint">
                  <code className="wb-wrap-anywhere">
                    {isRemote
                      ? (server.url ?? "")
                      : JSON.stringify([server.command, ...server.args])}
                  </code>
                  {server.hasPrivateHeaders && (
                    <p className="mcp-card-cred wb-muted">
                      <LockKey size={13} aria-hidden="true" />
                      <span>
                        已配置私密认证凭据
                        {server.headerCount !== undefined
                          ? `（共 ${server.headerCount} 项）`
                          : ""}
                      </span>
                    </p>
                  )}
                </div>

                {health[server.id] && (
                  <p className="mcp-card-health">{health[server.id]}</p>
                )}

                <div className="mcp-card-actions">
                  <Button
                    size="sm"
                    variant={server.enabled ? "secondary" : "primary"}
                    disabled={busy}
                    onClick={() =>
                      void action(async (valid) => {
                        await window.forge.setMcpEnabled(
                          server.id,
                          !server.enabled,
                        );
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
                    variant="secondary"
                    icon={<Plugs size={13} />}
                    disabled={busy}
                    onClick={() =>
                      void action(async (valid) => {
                        const value = await window.forge.getMcpHealth(
                          server.id,
                        );
                        if (!valid()) return;
                        setHealth((previous) => ({
                          ...previous,
                          [server.id]: `${value.connected ? "连接测试成功" : value.enabled ? "未连接" : "已禁用"}${value.negotiatedProtocolVersion ? ` · ${value.negotiatedProtocolVersion}` : ""}${value.lastError ? ` · ${value.lastError}` : ""}`,
                        }));
                      })
                    }
                  >
                    {isRemote ? "测试连接" : "测试连接（启动已启用服务器）"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mcp-btn-remove"
                    icon={<Trash size={13} />}
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
                </div>
              </article>
            );
          })}

          <button
            type="button"
            className="mcp-card mcp-add-card"
            disabled={busy}
            onClick={() => setRegistering(true)}
          >
            <div className="mcp-card-top">
              <div
                className="mcp-card-icon mcp-add-card-icon"
                aria-hidden="true"
              >
                <Plus size={20} weight="bold" />
              </div>
              <div className="mcp-card-heading">
                <strong className="mcp-card-title">
                  <span className="mcp-card-name">添加 MCP</span>
                </strong>
                <span className="mcp-card-id">stdio / HTTP / SSE</span>
              </div>
            </div>
            <p className="mcp-card-desc wb-muted">
              接入本地 stdio 进程或远程 HTTP / SSE
              工具服务，扩展外部工具与数据访问能力。
            </p>
            <span className="mcp-add-card-cta">
              <PuzzlePiece size={14} weight="duotone" aria-hidden="true" />
              <span>注册服务器</span>
            </span>
          </button>
        </div>
      </section>
      <Dialog
        open={registering}
        title="注册 MCP 服务器"
        onClose={() => {
          setRegistering(false);
          resetForm();
        }}
      >
        <form
          className="modal-content wb-stack"
          onSubmit={(e) => {
            e.preventDefault();
            let parsedArgs: unknown;
            if (transport === "stdio") {
              try {
                parsedArgs = JSON.parse(args);
              } catch {
                parsedArgs = undefined;
              }
            }

            const trimmedId = serverId.trim();
            const trimmedLabel = label.trim();
            const trimmedUrl = url.trim();
            const trimmedAuth = authorization.trim();

            const payload =
              transport === "stdio"
                ? {
                    id: trimmedId,
                    label: trimmedLabel,
                    command: command.trim(),
                    args: parsedArgs,
                    enabled: false,
                  }
                : {
                    id: trimmedId,
                    label: trimmedLabel,
                    transport,
                    url: trimmedUrl,
                    ...(trimmedAuth
                      ? { headers: { Authorization: trimmedAuth } }
                      : {}),
                    enabled: false,
                  };

            const parsed = mcpRegisterDtoSchema.safeParse(payload);
            if (!parsed.success) {
              const next: Record<string, string> = {};
              for (const issue of parsed.error.issues) {
                if (issue.code === "invalid_union") {
                  for (const subError of issue.unionErrors) {
                    for (const subIssue of subError.issues) {
                      const key = String(subIssue.path[0] ?? "");
                      if (key) next[key] ??= subIssue.message;
                    }
                  }
                } else {
                  const key = String(issue.path[0] ?? "");
                  if (key) next[key] ??= issue.message;
                }
              }
              if (transport === "stdio" && parsedArgs === undefined) {
                next.args = "参数必须是 JSON 字符串数组";
              }
              if (transport !== "stdio" && !trimmedUrl) {
                next.url = "URL 不能为空";
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
              resetForm();
            });
          }}
        >
          <Field
            id="mcp-server-transport"
            label="传输方式"
            helper="本地可执行文件使用 stdio；远程服务使用 HTTP 或 SSE。"
          >
            <Select
              id="mcp-server-transport"
              name="transport"
              options={TRANSPORT_OPTIONS}
              value={transport}
              onChange={(e) => {
                setTransport(e.target.value as McpTransportType);
                setFieldErrors({});
              }}
            />
          </Field>
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
          {transport === "stdio" ? (
            <>
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
            </>
          ) : (
            <>
              <Field
                id="mcp-server-url"
                label="服务器 URL"
                helper="以 http:// 或 https:// 开头的远程 MCP 地址。"
                error={fieldErrors.url}
              >
                <Input
                  id="mcp-server-url"
                  name="url"
                  autoComplete="off"
                  isMono
                  isError={Boolean(fieldErrors.url)}
                  aria-describedby={
                    fieldErrors.url
                      ? "mcp-server-url-error"
                      : "mcp-server-url-helper"
                  }
                  className="wb-wrap-anywhere"
                  placeholder="https://example.com/mcp"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <Field
                id="mcp-server-auth"
                label="私密 Authorization 凭据（可选）"
                helper="例如 Bearer token；留空则不发送 Authorization。"
                error={fieldErrors.headers}
              >
                <Input
                  id="mcp-server-auth"
                  name="authorization"
                  type="password"
                  autoComplete="off"
                  isMono
                  isError={Boolean(fieldErrors.headers)}
                  aria-describedby={
                    fieldErrors.headers
                      ? "mcp-server-auth-error"
                      : "mcp-server-auth-helper"
                  }
                  placeholder="例如 Bearer eyJhbGciOi..."
                  value={authorization}
                  onChange={(e) => setAuthorization(e.target.value)}
                />
              </Field>
            </>
          )}
          <p className="wb-muted">
            {transport === "stdio"
              ? "注册不启动进程，新服务器默认禁用，之后仍需显式启用。"
              : "注册后点击“启用”，再测试连接。"}
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
