import {
  ArrowClockwise,
  FloppyDisk,
  Plugs,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  ModelAccessRequest,
  ModelAccessResult,
  PublicAccountLogin,
  PublicProviderPreset,
  RouteGroup,
  RouteMember,
} from "../../../shared/model-access";
import type {
  ModelCatalog,
  ModelCatalogEntry,
} from "../../../shared/model-catalog";
import type { AgentEvent, PublicProviderSource } from "../../../shared/schemas";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import { Dialog } from "./Dialog";
import "./model-access.css";

export type ProviderProtocol = NonNullable<PublicProviderSource["apiMode"]>;
export type AccountQuota = Extract<
  ModelAccessResult,
  { type: "quota" }
>["quota"];
type ModelSelectionSource = NonNullable<PublicProviderSource["modelSelection"]>;

export type EditableCredential = Readonly<{
  id: string;
  label: string;
  enabled: boolean;
  type: "api-key" | "account";
  apiKey: string;
  clearKey: boolean;
  status: string;
  platform?: string | undefined;
  expiresAt?: number | undefined;
  protocol?: ProviderProtocol | undefined;
}>;

export type EditableHeader = Readonly<{
  id: string;
  name: string;
  value: string;
  stored: boolean;
}>;

export type ConnectionDraft = Readonly<{
  authEditing: boolean;
  authType: "auto" | "bearer" | "api-key" | "header" | "none";
  authHeader: string;
  authPrefix: string;
  headersEditing: boolean;
  headersDirty: boolean;
  headers: readonly EditableHeader[];
  extraBodyEditing: boolean;
  extraBodyText: string;
  hasExtraBody: boolean;
  vertexEditing: boolean;
  vertexText: string;
  hasVertex: boolean;
  proxyEditing: boolean;
  proxyUrl: string;
}>;

export type EditableModelSelection = Readonly<{
  mode: "all" | "selected" | "none";
  models: readonly string[];
  manual: ModelCatalog;
  overrides: ModelSelectionSource["overrides"];
}>;

export type EditableAlias = Readonly<{
  id: string;
  alias: string;
  model: string;
}>;

export type AccessDraft = Readonly<{
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiMode: ProviderProtocol;
  preset: string;
  region: string;
  endpoints: Readonly<Partial<Record<ProviderProtocol, string | undefined>>>;
  modelSelection: EditableModelSelection;
  aliases: readonly EditableAlias[];
  credentialRouting:
    | "order"
    | "rotate"
    | "usage"
    | "smart"
    | "pace"
    | undefined;
  sticky: boolean;
  activeCredentialId: string | undefined;
  credentials: readonly EditableCredential[];
  connection: ConnectionDraft;
  revision: number | undefined;
}>;

export type CatalogTestState = Readonly<{
  kind: "catalog" | "inference";
  status: "running" | "ok" | "error" | "cancelled";
  latencyMs?: number | undefined;
  model?: string | undefined;
  error?: string | undefined;
}>;

const protocolOptions = [
  { value: "chat-completions", label: "Chat Completions" },
  { value: "responses", label: "Responses" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "gemini", label: "Gemini" },
] as const;

const credentialStatus: Readonly<Record<string, string>> = {
  ready: "可用",
  disabled: "已停用",
  "signed-out": "未登录",
  expired: "已过期",
};

export const protocolLabel = (protocol: string | undefined) =>
  protocolOptions.find(
    (entry) => entry.value === (protocol ?? "chat-completions"),
  )?.label ??
  protocol ??
  "Chat Completions";

const statusLabel = (value: string) => credentialStatus[value] ?? value;
const randomId = (prefix: string) =>
  `${prefix}-${Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => n.toString(36)).join("")}`;

export function credentialRows(
  source: PublicProviderSource | undefined,
): readonly EditableCredential[] {
  if (source?.credentials?.length)
    return source.credentials.map((item) => ({
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      type: item.type,
      apiKey: "",
      clearKey: false,
      status: item.status,
      ...(item.platform ? { platform: item.platform } : {}),
      ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }),
      ...(item.protocol ? { protocol: item.protocol } : {}),
    }));
  return [
    {
      id: "default",
      label: "默认",
      enabled: true,
      type: "api-key",
      apiKey: "",
      clearKey: false,
      status: "ready",
    },
  ];
}

export function freshCredentials(): readonly EditableCredential[] {
  return [
    {
      id: "default",
      label: "默认",
      enabled: true,
      type: "api-key",
      apiKey: "",
      clearKey: false,
      status: "ready",
    },
  ];
}

export function connectionDraft(
  source?: PublicProviderSource,
): ConnectionDraft {
  return {
    authEditing: false,
    authType: source?.connection?.auth?.type ?? "auto",
    authHeader: source?.connection?.auth?.header ?? "",
    authPrefix: "",
    headersEditing: false,
    headersDirty: false,
    headers: (source?.connection?.headerNames ?? []).map((name) => ({
      id: randomId("header"),
      name,
      value: "",
      stored: true,
    })),
    extraBodyEditing: false,
    extraBodyText: "",
    hasExtraBody: source?.connection?.hasExtraBody === true,
    vertexEditing: false,
    vertexText: "",
    hasVertex: source?.connection?.hasVertex === true,
    proxyEditing: false,
    proxyUrl: "",
  };
}

export function selectionDraft(
  source?: PublicProviderSource,
): EditableModelSelection {
  return {
    mode: source?.modelSelection?.mode ?? "all",
    models: source?.modelSelection?.models ?? [],
    manual: source?.modelSelection?.manual ?? [],
    overrides: source?.modelSelection?.overrides,
  };
}

export function aliasDraft(
  source?: PublicProviderSource,
): readonly EditableAlias[] {
  return Object.entries(source?.modelAliases ?? {}).map(([alias, model]) => ({
    id: randomId("alias"),
    alias,
    model,
  }));
}

export function freshAccessDraft(id: string): AccessDraft {
  return {
    id,
    label: "",
    baseUrl: "",
    model: "",
    apiMode: "chat-completions",
    preset: "",
    region: "",
    endpoints: {},
    modelSelection: {
      mode: "all",
      models: [],
      manual: [],
      overrides: undefined,
    },
    aliases: [],
    credentialRouting: undefined,
    sticky: false,
    activeCredentialId: "default",
    credentials: freshCredentials(),
    connection: connectionDraft(),
    revision: undefined,
  };
}

export function accessDraft(source: PublicProviderSource): AccessDraft {
  return {
    id: source.id,
    label: source.label,
    baseUrl: source.baseUrl,
    model: source.model,
    apiMode: source.apiMode ?? "chat-completions",
    preset: source.preset ?? "",
    region: "",
    endpoints: source.endpoints ?? {},
    modelSelection: selectionDraft(source),
    aliases: aliasDraft(source),
    credentialRouting: source.credentialRouting,
    sticky: source.sticky === true,
    activeCredentialId:
      source.activeCredentialId ?? source.credentials?.[0]?.id ?? "default",
    credentials: credentialRows(source),
    connection: connectionDraft(source),
    revision: source.revision,
  };
}

export function modelSelectionObject(selection: EditableModelSelection) {
  return {
    mode: selection.mode,
    ...(selection.mode === "selected" ? { models: [...selection.models] } : {}),
    ...(selection.manual.length ? { manual: [...selection.manual] } : {}),
    ...(selection.overrides ? { overrides: selection.overrides } : {}),
  };
}

export function aliasesObject(
  rows: readonly EditableAlias[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const alias = row.alias.trim();
    const model = row.model.trim();
    if (alias && model) out[alias] = model;
  }
  return out;
}

export function endpointProblem(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "请填写 API 基础地址。";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "API 地址必须是完整的 http(s) URL。";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return "API 地址只支持 http 或 https。";
  if (url.username || url.password) return "API 地址不能包含用户名或密码。";
  if (url.search || url.hash) return "API 地址不能包含查询参数或锚点。";
  return "";
}

export function describedFailure(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，未自动重试。";
}

function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return "?";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function price(
  value: number | undefined,
  currency: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return `${value} ${currency ?? ""}`.trim();
}

export function ModelMetadata({
  entry,
}: { readonly entry: ModelCatalogEntry }) {
  const prices = [
    price(entry.pricing?.input, entry.pricing?.currency),
    price(entry.pricing?.output, entry.pricing?.currency),
  ].filter(Boolean);
  const provenance = Object.entries(entry.provenance ?? {});
  return (
    <span className="model-access-meta">
      <span>上下文 {formatTokens(entry.contextWindowTokens)}</span>
      <span>输出 {formatTokens(entry.maxOutputTokens)}</span>
      <span>
        工具 {entry.tools === undefined ? "?" : entry.tools ? "是" : "否"}
      </span>
      <span>
        视觉 {entry.vision === undefined ? "?" : entry.vision ? "是" : "否"}
      </span>
      {entry.reasoningEfforts?.length ? (
        <span>推理 {entry.reasoningEfforts.join("/")}</span>
      ) : (
        <span>推理 ?</span>
      )}
      {prices.length > 0 && (
        <span>
          价格 {prices.join(" / ")}
          {entry.pricing?.source ? ` · ${entry.pricing.source}` : ""}
          {entry.pricing?.updatedAt ? ` · ${entry.pricing.updatedAt}` : ""}
        </span>
      )}
      {provenance.map(([field, source]) => (
        <span key={field}>
          {field}={source}
        </span>
      ))}
    </span>
  );
}

export function PresetPicker({
  presets,
  preset,
  region,
  onPreset,
  onRegion,
}: {
  readonly presets: readonly PublicProviderPreset[];
  readonly preset: string;
  readonly region: string;
  readonly onPreset: (id: string) => void;
  readonly onRegion: (id: string) => void;
}) {
  const chosen = presets.find((item) => item.id === preset);
  return (
    <div className="model-access-preset">
      <Field id="model-access-preset" label="预设">
        <Select
          id="model-access-preset"
          value={preset}
          options={[
            { value: "", label: "自定义" },
            ...presets.map((item) => ({ value: item.id, label: item.name })),
          ]}
          onChange={(event) => onPreset(event.target.value)}
        />
      </Field>
      {chosen?.regions?.length ? (
        <Field id="model-access-region" label={chosen.regionLabel ?? "区域"}>
          <Select
            id="model-access-region"
            value={region}
            options={[
              { value: "", label: "默认" },
              ...chosen.regions.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
            onChange={(event) => onRegion(event.target.value)}
          />
        </Field>
      ) : null}
    </div>
  );
}

export function presetEndpoints(
  preset: PublicProviderPreset | undefined,
  regionId: string,
): Readonly<Partial<Record<ProviderProtocol, string | undefined>>> {
  if (!preset) return {};
  const region = regionId
    ? preset.regions?.find((item) => item.id === regionId)
    : undefined;
  return { ...preset.endpoints, ...region?.endpoints };
}

export function ModelSelectionEditor({
  catalog,
  loading,
  error,
  stale,
  fetchedAt,
  model,
  selection,
  aliases,
  disabled,
  test,
  onModel,
  onSelection,
  onAliases,
  onRefresh,
  onTest,
  onCancelTest,
}: {
  readonly catalog: ModelCatalog;
  readonly loading: boolean;
  readonly error: string;
  readonly stale?: boolean;
  readonly fetchedAt?: string | undefined;
  readonly model: string;
  readonly selection: EditableModelSelection;
  readonly aliases: readonly EditableAlias[];
  readonly disabled: boolean;
  readonly test: CatalogTestState | undefined;
  readonly onModel: (value: string) => void;
  readonly onSelection: (value: EditableModelSelection) => void;
  readonly onAliases: (value: readonly EditableAlias[]) => void;
  readonly onRefresh: () => void;
  readonly onTest: (kind: "catalog" | "inference") => void;
  readonly onCancelTest: () => void;
}) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState("");
  const [visible, setVisible] = useState(50);
  const listId = useId();
  const byId = new Map<string, ModelCatalogEntry>();
  for (const entry of selection.manual) byId.set(entry.id, entry);
  for (const entry of catalog) byId.set(entry.id, entry);
  const entries = [...byId.values()];
  const needle = query.trim().toLowerCase();
  const filtered = entries.filter(
    (entry) =>
      !needle ||
      entry.id.toLowerCase().includes(needle) ||
      entry.displayName?.toLowerCase().includes(needle),
  );
  const selectedIds = selection.mode === "selected" ? selection.models : [];
  const toggle = (id: string) => {
    const base =
      selection.mode === "selected"
        ? selection.models
        : entries.map((entry) => entry.id);
    const next = base.includes(id)
      ? base.filter((value) => value !== id)
      : [...base, id];
    onSelection({ ...selection, mode: "selected", models: next });
  };
  const addManual = () => {
    const id = manual.trim();
    if (!id) return;
    if (!byId.has(id)) {
      const entry: ModelCatalogEntry = { id, contextWindowTokens: null };
      onSelection({
        ...selection,
        ...(selection.mode === "selected"
          ? { models: [...selection.models, id] }
          : {}),
        manual: [...selection.manual, entry],
      });
    }
    setManual("");
  };
  const removeManual = (id: string) => {
    onSelection({
      ...selection,
      manual: selection.manual.filter((entry) => entry.id !== id),
      ...(selection.mode === "selected"
        ? { models: selection.models.filter((value) => value !== id) }
        : {}),
    });
  };
  return (
    <section className="model-access-section" aria-label="模型">
      <div className="model-access-heading">
        <h4>模型</h4>
        <div className="model-access-actions">
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowClockwise size={15} />}
            loading={loading}
            disabled={disabled}
            onClick={onRefresh}
          >
            刷新目录
          </Button>
        </div>
      </div>
      <Field id="model-access-default-model" label="默认模型">
        <Input
          id="model-access-default-model"
          value={model}
          spellCheck={false}
          placeholder="模型 ID"
          onChange={(event) => onModel(event.target.value)}
        />
      </Field>
      <div
        className="model-access-modes"
        role="radiogroup"
        aria-label="模型范围"
      >
        {(
          [
            ["all", "全部"],
            ["selected", "选择"],
            ["none", "不提供"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="model-access-mode">
            <input
              type="radio"
              name="model-access-mode"
              value={value}
              checked={selection.mode === value}
              onChange={() =>
                onSelection({
                  ...selection,
                  mode: value,
                  models:
                    value === "selected" && selection.models.length === 0
                      ? entries.map((entry) => entry.id)
                      : selection.models,
                })
              }
            />
            {label}
          </label>
        ))}
      </div>
      <div className="model-access-catalog-toolbar">
        <Input
          aria-label="搜索模型"
          value={query}
          placeholder="搜索模型"
          onChange={(event) => {
            setQuery(event.target.value);
            setVisible(50);
          }}
        />
        <span>
          {filtered.length} / {entries.length}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => onTest("catalog")}
        >
          测试目录
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || !model.trim()}
          onClick={() => onTest("inference")}
        >
          测试推理
        </Button>
        {test?.status === "running" && (
          <Button size="sm" variant="ghost" onClick={onCancelTest}>
            取消测试
          </Button>
        )}
      </div>
      {stale && (
        <p className="model-access-status is-stale" role="status">
          目录已过期
          {fetchedAt && !Number.isNaN(new Date(fetchedAt).getTime())
            ? ` · ${new Date(fetchedAt).toLocaleString()}`
            : ""}
        </p>
      )}
      {test && test.status !== "running" && (
        <output
          className={`model-access-test-result${test.status === "error" ? " is-error" : ""}`}
          role={test.status === "error" ? "alert" : undefined}
        >
          {test.kind === "catalog" ? "目录测试" : "推理测试"}
          {test.status === "ok"
            ? `成功 · ${test.latencyMs ?? 0} ms${test.model ? ` · ${test.model}` : ""}`
            : test.status === "cancelled"
              ? "已取消"
              : `失败${test.error ? ` · ${test.error}` : ""}`}
        </output>
      )}
      <div
        id={listId}
        className="model-access-catalog"
        aria-label="模型目录"
        aria-busy={loading}
      >
        {filtered.length ? (
          <div className="model-access-model-list">
            {filtered.slice(0, visible).map((entry) => {
              const isManual = selection.manual.some(
                (item) => item.id === entry.id,
              );
              return (
                <div className="model-access-model-row" key={entry.id}>
                  <label className="model-access-model-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(entry.id)}
                      disabled={disabled || selection.mode !== "selected"}
                      onChange={() => toggle(entry.id)}
                    />
                    <span className="model-access-model-id">{entry.id}</span>
                  </label>
                  {entry.displayName && (
                    <span className="model-access-model-name">
                      {entry.displayName}
                    </span>
                  )}
                  <ModelMetadata entry={entry} />
                  {isManual && (
                    <button
                      type="button"
                      className="model-access-icon-button"
                      aria-label={`移除手工模型 ${entry.id}`}
                      disabled={disabled}
                      onClick={() => removeManual(entry.id)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="model-access-status">{error || "目录为空。"}</p>
        )}
        {filtered.length > visible && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setVisible((count) => count + 50)}
          >
            显示更多（剩余 {filtered.length - visible}）
          </Button>
        )}
      </div>
      {error && filtered.length > 0 && (
        <p className="model-access-status is-error" role="alert">
          {error}
        </p>
      )}
      <div className="model-access-inline">
        <Input
          aria-label="手工模型 ID"
          value={manual}
          placeholder="手工模型 ID"
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addManual();
            }
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} />}
          disabled={disabled || !manual.trim()}
          onClick={addManual}
        >
          添加模型
        </Button>
      </div>
      <details className="model-access-fold">
        <summary>模型别名</summary>
        <div className="model-access-rows">
          {aliases.map((row) => (
            <div className="model-access-row" key={row.id}>
              <Input
                aria-label="别名"
                value={row.alias}
                placeholder="别名"
                onChange={(event) =>
                  onAliases(
                    aliases.map((item) =>
                      item.id === row.id
                        ? { ...item, alias: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <Input
                aria-label="别名目标模型"
                value={row.model}
                placeholder="模型 ID"
                onChange={(event) =>
                  onAliases(
                    aliases.map((item) =>
                      item.id === row.id
                        ? { ...item, model: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="model-access-icon-button"
                aria-label="删除别名"
                disabled={disabled}
                onClick={() =>
                  onAliases(aliases.filter((item) => item.id !== row.id))
                }
              >
                <Trash size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus size={14} />}
            disabled={disabled}
            onClick={() =>
              onAliases([
                ...aliases,
                { id: randomId("alias"), alias: "", model: "" },
              ])
            }
          >
            添加别名
          </Button>
        </div>
      </details>
      {selection.mode === "none" && (
        <p className="model-access-status">不提供模型。</p>
      )}
    </section>
  );
}

export function ConnectionEditor({
  connection,
  disabled,
  onChange,
}: {
  readonly connection: ConnectionDraft;
  readonly disabled: boolean;
  readonly onChange: (value: ConnectionDraft) => void;
}) {
  const [extraBodyError, setExtraBodyError] = useState("");
  const [vertexError, setVertexError] = useState("");
  const patch = (value: Partial<ConnectionDraft>) =>
    onChange({ ...connection, ...value });
  return (
    <details className="model-access-fold model-access-connection">
      <summary>连接</summary>
      <div className="model-access-section-body">
        <div className="model-access-connection-row">
          <span className="model-access-field-label">鉴权</span>
          <span className="model-access-status">
            {connection.authType}
            {connection.authHeader ? ` · ${connection.authHeader}` : ""}
          </span>
          <label className="model-access-check">
            <input
              type="checkbox"
              checked={connection.authEditing}
              disabled={disabled}
              onChange={(event) => patch({ authEditing: event.target.checked })}
            />
            修改鉴权
          </label>
        </div>
        {connection.authEditing && (
          <div className="model-access-form-grid">
            <Field id="model-access-auth-type" label="鉴权方式">
              <Select
                id="model-access-auth-type"
                value={connection.authType}
                options={[
                  { value: "auto", label: "自动" },
                  { value: "bearer", label: "Bearer" },
                  { value: "api-key", label: "API Key" },
                  { value: "header", label: "自定义请求头" },
                  { value: "none", label: "无" },
                ]}
                onChange={(event) =>
                  patch({
                    authType: event.target.value as ConnectionDraft["authType"],
                  })
                }
              />
            </Field>
            {connection.authType === "header" && (
              <Field id="model-access-auth-header" label="鉴权请求头">
                <Input
                  id="model-access-auth-header"
                  value={connection.authHeader}
                  placeholder="X-Api-Key"
                  onChange={(event) =>
                    patch({ authHeader: event.target.value })
                  }
                />
              </Field>
            )}
            <Field id="model-access-auth-prefix" label="鉴权前缀">
              <Input
                id="model-access-auth-prefix"
                value={connection.authPrefix}
                placeholder="留空"
                onChange={(event) => patch({ authPrefix: event.target.value })}
              />
            </Field>
          </div>
        )}
        <div className="model-access-connection-row">
          <span className="model-access-field-label">请求头</span>
          <span className="model-access-status">
            {connection.headers.length
              ? connection.headers.map((header) => header.name).join(", ")
              : "无"}
          </span>
          <label className="model-access-check">
            <input
              type="checkbox"
              checked={connection.headersEditing}
              disabled={disabled}
              onChange={(event) =>
                patch({ headersEditing: event.target.checked })
              }
            />
            修改请求头
          </label>
          {connection.headers.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label="清除全部请求头"
              onClick={() =>
                patch({ headersEditing: true, headersDirty: true, headers: [] })
              }
            >
              清除
            </Button>
          )}
        </div>
        {connection.headersEditing && (
          <div className="model-access-rows">
            {connection.headers.map((header) => (
              <div className="model-access-row" key={header.id}>
                <Input
                  aria-label="请求头名称"
                  value={header.name}
                  placeholder="名称"
                  onChange={(event) =>
                    patch({
                      headersDirty: true,
                      headers: connection.headers.map((item) =>
                        item.id === header.id
                          ? { ...item, name: event.target.value, stored: false }
                          : item,
                      ),
                    })
                  }
                />
                <Input
                  aria-label="请求头值"
                  value={header.value}
                  placeholder={header.stored ? "已保存，留空保留" : "值"}
                  onChange={(event) =>
                    patch({
                      headersDirty: true,
                      headers: connection.headers.map((item) =>
                        item.id === header.id
                          ? {
                              ...item,
                              value: event.target.value,
                              stored: false,
                            }
                          : item,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  className="model-access-icon-button"
                  aria-label="删除请求头"
                  disabled={disabled}
                  onClick={() =>
                    patch({
                      headersDirty: true,
                      headers: connection.headers.filter(
                        (item) => item.id !== header.id,
                      ),
                    })
                  }
                >
                  <Trash size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={14} />}
              disabled={disabled}
              onClick={() =>
                patch({
                  headersDirty: true,
                  headers: [
                    ...connection.headers,
                    {
                      id: randomId("header"),
                      name: "",
                      value: "",
                      stored: false,
                    },
                  ],
                })
              }
            >
              添加请求头
            </Button>
          </div>
        )}
        <div className="model-access-connection-row">
          <span className="model-access-field-label">额外参数</span>
          <span className="model-access-status">
            {connection.extraBodyEditing
              ? connection.extraBodyText.trim() || "未修改"
              : connection.hasExtraBody
                ? "已设置"
                : "无"}
          </span>
          <label className="model-access-check">
            <input
              type="checkbox"
              checked={connection.extraBodyEditing}
              disabled={disabled}
              onChange={(event) => {
                setExtraBodyError("");
                patch({ extraBodyEditing: event.target.checked });
              }}
            />
            修改额外参数
          </label>
          {connection.hasExtraBody && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label="清除额外参数"
              onClick={() =>
                patch({ extraBodyEditing: true, extraBodyText: "{}" })
              }
            >
              清除
            </Button>
          )}
        </div>
        {connection.extraBodyEditing && (
          <Field
            id="model-access-extra-body"
            label="额外参数 JSON"
            error={extraBodyError || undefined}
          >
            <textarea
              id="model-access-extra-body"
              className="model-access-json"
              value={connection.extraBodyText}
              spellCheck={false}
              rows={4}
              placeholder="{}"
              onChange={(event) => {
                const value = event.target.value;
                setExtraBodyError("");
                patch({ extraBodyText: value });
                if (!value.trim()) return;
                try {
                  const parsed: unknown = JSON.parse(value);
                  if (
                    !parsed ||
                    Array.isArray(parsed) ||
                    typeof parsed !== "object"
                  )
                    setExtraBodyError("必须是 JSON 对象。");
                } catch {
                  setExtraBodyError("JSON 格式错误。");
                }
              }}
            />
          </Field>
        )}
        <div className="model-access-connection-row">
          <span className="model-access-field-label">代理</span>
          <span className="model-access-status">
            {connection.proxyEditing
              ? connection.proxyUrl.trim() || "清除"
              : connection.proxyUrl
                ? "已设置"
                : "无"}
          </span>
          <label className="model-access-check">
            <input
              type="checkbox"
              checked={connection.proxyEditing}
              disabled={disabled}
              onChange={(event) =>
                patch({ proxyEditing: event.target.checked })
              }
            />
            修改代理
          </label>
        </div>
        {connection.proxyEditing && (
          <Field id="model-access-proxy" label="代理地址">
            <Input
              id="model-access-proxy"
              value={connection.proxyUrl}
              placeholder="http://127.0.0.1:7890"
              onChange={(event) => patch({ proxyUrl: event.target.value })}
            />
          </Field>
        )}
        <div className="model-access-connection-row">
          <span className="model-access-field-label">Vertex JSON</span>
          <span className="model-access-status">
            {connection.vertexEditing
              ? connection.vertexText.trim() || "留空保留"
              : connection.hasVertex
                ? "已保存"
                : "无"}
          </span>
          <label className="model-access-check">
            <input
              type="checkbox"
              checked={connection.vertexEditing}
              disabled={disabled}
              onChange={(event) => {
                setVertexError("");
                patch({ vertexEditing: event.target.checked });
              }}
            />
            修改 Vertex
          </label>
          {connection.hasVertex && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label="清除 Vertex 配置"
              onClick={() => {
                setVertexError("");
                patch({ vertexEditing: true, vertexText: "null" });
              }}
            >
              清除
            </Button>
          )}
        </div>
        {connection.vertexEditing && (
          <Field
            id="model-access-vertex"
            label="Vertex JSON"
            error={vertexError || undefined}
          >
            <textarea
              id="model-access-vertex"
              className="model-access-json"
              value={connection.vertexText}
              spellCheck={false}
              rows={5}
              placeholder={
                connection.hasVertex
                  ? "已保存，留空保留；null 清除"
                  : '{"project":"…","credentials":{…}}'
              }
              onChange={(event) => {
                const value = event.target.value;
                setVertexError("");
                patch({ vertexText: value });
                if (!value.trim()) return;
                try {
                  const parsed: unknown = JSON.parse(value);
                  if (
                    parsed !== null &&
                    (!parsed ||
                      Array.isArray(parsed) ||
                      typeof parsed !== "object")
                  )
                    setVertexError("必须是 JSON 对象或 null。");
                } catch {
                  setVertexError("JSON 格式错误。");
                }
              }}
            />
          </Field>
        )}
      </div>
    </details>
  );
}

function QuotaView({ quota }: { readonly quota: AccountQuota }) {
  return (
    <div className="model-access-quota">
      <span className="model-access-quota-head">
        {[quota.platform, quota.plan].filter(Boolean).join(" · ")}
      </span>
      {quota.windows.map((window) => (
        <div className="model-access-quota-row" key={window.id}>
          <span>{window.name}</span>
          <span>
            {window.unlimited
              ? "不限"
              : `${window.remaining ?? "?"} / ${window.limit ?? "?"}`}
          </span>
          {window.usedPercent !== null && (
            <span>{Number(window.usedPercent.toFixed(1))}%</span>
          )}
          {window.resetAt && (
            <span>{new Date(window.resetAt).toLocaleString()}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function CredentialsEditor({
  sourceId,
  sourceReady,
  credentials,
  activeCredentialId,
  disabled,
  onCredentials,
  onActive,
  onCompleted,
}: {
  readonly sourceId: string;
  readonly sourceReady: boolean;
  readonly credentials: readonly EditableCredential[];
  readonly activeCredentialId: string | undefined;
  readonly disabled: boolean;
  readonly onCredentials: (value: readonly EditableCredential[]) => void;
  readonly onActive: (value: string) => void;
  readonly onCompleted: () => Promise<void>;
}) {
  const [quota, setQuota] = useState<Readonly<Record<string, AccountQuota>>>(
    {},
  );
  const [quotaError, setQuotaError] = useState<
    Readonly<Record<string, string>>
  >({});
  const [quotaBusy, setQuotaBusy] = useState<Readonly<Record<string, boolean>>>(
    {},
  );
  const update = (id: string, patch: Partial<EditableCredential>) =>
    onCredentials(
      credentials.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    );
  const remove = (credential: EditableCredential) => {
    const remaining = credentials.filter((item) => item.id !== credential.id);
    if (!remaining.length) {
      onCredentials(freshCredentials());
      onActive("default");
      return;
    }
    onCredentials(remaining);
    if (activeCredentialId === credential.id)
      onActive(remaining.find((item) => item.enabled)?.id ?? remaining[0]!.id);
  };
  const loadQuota = async (credential: EditableCredential) => {
    if (!window.forge.modelAccess) {
      setQuotaError((old) => ({
        ...old,
        [credential.id]: "当前宿主不支持额度查询。",
      }));
      return;
    }
    setQuotaBusy((old) => ({ ...old, [credential.id]: true }));
    setQuotaError((old) => ({ ...old, [credential.id]: "" }));
    try {
      const result = await window.forge.modelAccess({
        type: "quota",
        sourceId,
        credentialId: credential.id,
      });
      if (result.type === "quota")
        setQuota((old) => ({ ...old, [credential.id]: result.quota }));
    } catch (error) {
      setQuotaError((old) => ({
        ...old,
        [credential.id]: describedFailure(error),
      }));
    } finally {
      setQuotaBusy((old) => ({ ...old, [credential.id]: false }));
    }
  };
  return (
    <section className="model-access-section" aria-label="账号与凭据">
      <div className="model-access-heading">
        <h4>账号与凭据</h4>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} />}
          disabled={disabled}
          onClick={() =>
            onCredentials([
              ...credentials,
              {
                id: randomId("key"),
                label: `API 密钥 ${credentials.length + 1}`,
                enabled: true,
                type: "api-key",
                apiKey: "",
                clearKey: false,
                status: "ready",
              },
            ])
          }
        >
          添加凭据
        </Button>
      </div>
      <div className="model-access-credential-list">
        {credentials.map((credential) => (
          <div className="model-access-credential" key={credential.id}>
            <div className="model-access-credential-head">
              <label className="model-access-radio">
                <input
                  type="radio"
                  name="model-access-active-credential"
                  checked={activeCredentialId === credential.id}
                  disabled={disabled || !credential.enabled}
                  onChange={() => onActive(credential.id)}
                  aria-label={`选择凭据 ${credential.label}`}
                />
                <Input
                  aria-label="凭据标签"
                  value={credential.label}
                  onChange={(event) =>
                    update(credential.id, { label: event.target.value })
                  }
                />
              </label>
              <span className="model-access-tag">
                {credential.type === "account"
                  ? `账号${credential.platform ? ` · ${credential.platform}` : ""}`
                  : "API Key"}
              </span>
              <span className="model-access-status">
                {statusLabel(credential.status)}
              </span>
              <label className="model-access-check">
                <input
                  type="checkbox"
                  checked={credential.enabled}
                  disabled={disabled}
                  aria-label={`启用凭据 ${credential.label}`}
                  onChange={(event) =>
                    update(credential.id, { enabled: event.target.checked })
                  }
                />
                启用
              </label>
            </div>
            {credential.type === "api-key" ? (
              <div className="model-access-credential-fields">
                <Field id={`model-access-key-${credential.id}`} label="密钥">
                  <Input
                    id={`model-access-key-${credential.id}`}
                    type="password"
                    autoComplete="off"
                    aria-label={`凭据密钥 ${credential.label}`}
                    value={credential.apiKey}
                    placeholder={
                      credential.status === "ready" && credential.apiKey === ""
                        ? "已保存，留空不变"
                        : "API 密钥"
                    }
                    disabled={disabled || credential.clearKey}
                    onChange={(event) =>
                      update(credential.id, { apiKey: event.target.value })
                    }
                  />
                </Field>
                <label className="model-access-check">
                  <input
                    type="checkbox"
                    checked={credential.clearKey}
                    disabled={disabled}
                    aria-label={`清除凭据密钥 ${credential.label}`}
                    onChange={(event) =>
                      update(credential.id, {
                        clearKey: event.target.checked,
                        ...(event.target.checked ? { apiKey: "" } : {}),
                      })
                    }
                  />
                  清除密钥
                </label>
                <button
                  type="button"
                  className="model-access-icon-button"
                  aria-label={`删除凭据 ${credential.label}`}
                  disabled={disabled}
                  onClick={() => remove(credential)}
                >
                  <Trash size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="model-access-credential-fields">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || quotaBusy[credential.id]}
                  loading={quotaBusy[credential.id] === true}
                  onClick={() => void loadQuota(credential)}
                  aria-label={`查询额度 ${credential.label}`}
                >
                  查询额度
                </Button>
                <button
                  type="button"
                  className="model-access-icon-button"
                  aria-label={`删除账号 ${credential.label}`}
                  disabled={disabled}
                  onClick={() => remove(credential)}
                >
                  <Trash size={14} aria-hidden="true" />
                </button>
                {quota[credential.id] && (
                  <QuotaView quota={quota[credential.id]!} />
                )}
                {quotaError[credential.id] && (
                  <span className="model-access-status is-error" role="alert">
                    {quotaError[credential.id]}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {sourceReady && (
        <AccountLoginPanel
          sourceId={sourceId}
          disabled={disabled}
          onCompleted={onCompleted}
        />
      )}
    </section>
  );
}

export function AccountLoginPanel({
  sourceId,
  disabled,
  onCompleted,
}: {
  readonly sourceId: string;
  readonly disabled: boolean;
  readonly onCompleted: () => Promise<void>;
}) {
  const [platform, setPlatform] = useState<"codex" | "copilot">("codex");
  const [login, setLogin] = useState<PublicAccountLogin | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loginRef = useRef<PublicAccountLogin | null>(null);
  loginRef.current = login;
  const completed = useRef(false);
  const finish = async () => {
    if (completed.current) return;
    completed.current = true;
    await onCompleted();
  };
  const poll = async (loginId: string) => {
    if (!window.forge.modelAccess) return;
    try {
      const result = await window.forge.modelAccess({
        type: "login-poll",
        loginId,
      });
      if (result.type !== "login-poll" || loginRef.current?.loginId !== loginId)
        return;
      setLogin(result.login);
      if (result.login.status === "done") await finish();
      if (result.login.status === "failed" || result.login.status === "expired")
        setError(
          result.login.error ??
            `登录${result.login.status === "expired" ? "已过期" : "失败"}。`,
        );
    } catch (pollError) {
      setError(describedFailure(pollError));
    }
  };
  useEffect(() => {
    const active = login?.status === "waiting" ? login : null;
    if (!active) return;
    const timer = setInterval(() => void poll(active.loginId), 2000);
    return () => clearInterval(timer);
    // poll is intentionally keyed to the current login id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login?.loginId, login?.status]);
  useEffect(() => {
    return () => {
      const active = loginRef.current;
      if (active?.status === "waiting" && window.forge.modelAccess)
        void window.forge
          .modelAccess({ type: "login-cancel", loginId: active.loginId })
          .catch(() => {});
    };
  }, []);
  const start = async () => {
    if (!window.forge.modelAccess) {
      setError("当前宿主不支持账号登录。");
      return;
    }
    setBusy(true);
    setError("");
    completed.current = false;
    try {
      const result = await window.forge.modelAccess({
        type: "login-start",
        sourceId,
        platform,
      });
      if (result.type === "login-start") setLogin(result.login);
    } catch (startError) {
      setError(describedFailure(startError));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    const active = loginRef.current;
    if (!active || !window.forge.modelAccess) return;
    setBusy(true);
    try {
      const result = await window.forge.modelAccess({
        type: "login-cancel",
        loginId: active.loginId,
      });
      if (result.type === "login-cancel") setLogin(result.login);
    } catch (cancelError) {
      setError(describedFailure(cancelError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="model-access-account">
      <div className="model-access-inline">
        <Select
          aria-label="账号平台"
          value={platform}
          options={[
            { value: "codex", label: "Codex" },
            { value: "copilot", label: "Copilot" },
          ]}
          onChange={(event) =>
            setPlatform(event.target.value === "copilot" ? "copilot" : "codex")
          }
        />
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={disabled || (!!login && login.status === "waiting")}
          onClick={() => void start()}
        >
          开始登录
        </Button>
        {login?.status === "waiting" && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void poll(login.loginId)}
            >
              查询
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void cancel()}
            >
              取消登录
            </Button>
          </>
        )}
      </div>
      {login && (
        <div className="model-access-login" aria-live="polite">
          <span className="model-access-status">
            {login.platform} ·{" "}
            {login.status === "waiting"
              ? "等待登录"
              : login.status === "done"
                ? "登录完成"
                : login.status}
          </span>
          {login.verificationUrl && (
            <Button
              size="sm"
              variant="secondary"
              icon={<Plugs size={14} />}
              onClick={() => {
                void window.forge
                  .openExternal(login.verificationUrl!)
                  .catch((openError) => {
                    setError(describedFailure(openError));
                  });
              }}
            >
              打开登录页面
            </Button>
          )}
          {login.userCode && (
            <code className="model-access-code">{login.userCode}</code>
          )}
          {login.account?.user && (
            <span className="model-access-status">{login.account.user}</span>
          )}
          {login.account?.plan && (
            <span className="model-access-tag">{login.account.plan}</span>
          )}
        </div>
      )}
      {error && (
        <span className="model-access-status is-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export function ImportPanel({
  onApplied,
}: {
  readonly onApplied: (ids: readonly string[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Extract<
    ModelAccessResult,
    { type: "import-preview" }
  > | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const access = (input: ModelAccessRequest) => {
    if (!window.forge.modelAccess)
      throw new Error("当前宿主不支持模型接入管理。");
    return window.forge.modelAccess(input);
  };
  const doPreview = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await access({ type: "import-preview", text });
      if (result.type === "import-preview") {
        setPreview(result);
        setSelected(new Set(result.sources.map((source) => source.id)));
      }
    } catch (previewError) {
      setPreview(null);
      setError(describedFailure(previewError));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await access({
        type: "import-apply",
        previewId: preview.previewId,
        sourceIds: [...selected],
      });
      if (result.type === "import-apply") {
        setMessage(`已导入 ${result.applied.length} 个来源。`);
        setPreview(null);
        setText("");
        await onApplied(result.applied);
      }
    } catch (applyError) {
      setError(describedFailure(applyError));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="model-access-fold model-access-import">
      <summary>导入来源</summary>
      <div className="model-access-section-body">
        <Field id="model-access-import-text" label="文本或链接">
          <textarea
            id="model-access-import-text"
            className="model-access-json"
            rows={4}
            value={text}
            spellCheck={false}
            placeholder="JSON 或导入链接"
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
              setMessage("");
            }}
          />
        </Field>
        <div className="model-access-actions">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !text.trim()}
            loading={busy && !preview}
            onClick={() => void doPreview()}
          >
            预览
          </Button>
          {preview && (
            <Button
              size="sm"
              disabled={busy || selected.size === 0}
              loading={busy}
              onClick={() => void apply()}
            >
              应用导入
            </Button>
          )}
        </div>
        {preview && (
          <div className="model-access-preview">
            <div className="model-access-preview-list">
              {preview.sources.map((source) => (
                <label className="model-access-preview-row" key={source.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(source.id)}
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.target.checked) next.add(source.id);
                      else next.delete(source.id);
                      setSelected(next);
                    }}
                  />
                  <span>{source.label}</span>
                  <code>{source.id}</code>
                  <span>{source.model}</span>
                  <span>{source.credentialCount} 凭据</span>
                  {source.warnings.map((warning) => (
                    <span
                      className="model-access-status is-error"
                      key={warning}
                    >
                      {warning}
                    </span>
                  ))}
                </label>
              ))}
            </div>
            {preview.warnings.length > 0 && (
              <ul className="model-access-warnings">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {message && <span className="model-access-status">{message}</span>}
        {error && (
          <span className="model-access-status is-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </details>
  );
}

const emptyRoute = (): RouteGroup => ({
  id: randomId("route"),
  label: "",
  strategy: "order",
  sticky: false,
  members: [{ sourceId: "", model: "", enabled: true }],
});

export function RouteGroupsPanel({
  catalogs,
}: {
  readonly catalogs: Readonly<Record<string, ModelCatalog>>;
}) {
  const { state, updateSettings } = useWorkbench();
  const sources = state.settings?.providerSources ?? [];
  const groups = state.settings?.routeGroups ?? [];
  const [draft, setDraft] = useState<RouteGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState("");
  const add = () => {
    setError("");
    setDraft(emptyRoute());
  };
  const edit = (group: RouteGroup) => {
    setError("");
    setDraft({
      ...group,
      members: group.members.map((member) => ({ ...member })),
    });
  };
  const save = async () => {
    if (!draft) return;
    if (!draft.label.trim()) {
      setError("请填写路由组名称。");
      return;
    }
    const members = draft.members.filter(
      (member) => member.sourceId.trim() && member.model.trim(),
    );
    if (!members.length) {
      setError("至少需要一个成员。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await updateSettings({
        route: {
          type: "save",
          group: { ...draft, label: draft.label.trim(), members },
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(null);
    } catch (saveError) {
      setError(describedFailure(saveError));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await updateSettings({ route: { type: "remove", id } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming("");
    } catch (removeError) {
      setError(describedFailure(removeError));
    } finally {
      setBusy(false);
    }
  };
  const patchMember = (index: number, patch: Partial<RouteMember>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      members: draft.members.map((member, at) =>
        at === index ? { ...member, ...patch } : member,
      ),
    });
  };
  return (
    <section className="model-access-routes" aria-label="路由组">
      <div className="model-access-heading">
        <h4>路由组</h4>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} />}
          disabled={!sources.length}
          onClick={add}
        >
          添加路由组
        </Button>
      </div>
      {groups.length === 0 ? (
        <p className="model-access-status">无路由组。</p>
      ) : (
        <ul className="model-access-route-list">
          {groups.map((group) => (
            <li className="model-access-route-card" key={group.id}>
              <div className="model-access-route-main">
                <strong>{group.label}</strong>
                <span className="model-access-tag">{group.strategy}</span>
                <span className="model-access-status">
                  {group.members.length} 个成员
                </span>
                {group.sticky && <span className="model-access-tag">黏性</span>}
              </div>
              <div className="model-access-route-members">
                {group.members.map((member, index) => {
                  const source = sources.find(
                    (item) => item.id === member.sourceId,
                  );
                  const credential =
                    source?.credentials?.find(
                      (item) => item.id === member.credentialId,
                    ) ?? source?.credentials?.[0];
                  return (
                    <span key={`${member.sourceId}:${member.model}:${index}`}>
                      {source?.label ?? member.sourceId} / {member.model}
                      {credential ? ` / ${credential.label}` : ""}
                    </span>
                  );
                })}
              </div>
              <div className="model-access-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => edit(group)}
                >
                  编辑路由组
                </Button>
                {confirming === group.id ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy}
                      onClick={() => void remove(group.id)}
                    >
                      确认删除路由组
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirming("")}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(group.id)}
                  >
                    删除路由组
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && !draft && (
        <span className="model-access-status is-error" role="alert">
          {error}
        </span>
      )}
      {draft && (
        <Dialog
          title={
            groups.some((group) => group.id === draft.id)
              ? "编辑路由组"
              : "添加路由组"
          }
          onClose={() => !busy && setDraft(null)}
          dismissible={!busy}
        >
          <div className="provider-editor model-access-route-editor">
            <Field id="model-access-route-label" label="名称">
              <Input
                id="model-access-route-label"
                value={draft.label}
                onChange={(event) =>
                  setDraft({ ...draft, label: event.target.value })
                }
              />
            </Field>
            <div className="model-access-form-grid">
              <Field id="model-access-route-strategy" label="策略">
                <Select
                  id="model-access-route-strategy"
                  value={draft.strategy}
                  options={[
                    { value: "order", label: "顺序" },
                    { value: "rotate", label: "轮换" },
                    { value: "usage", label: "用量" },
                    { value: "smart", label: "智能" },
                    { value: "pace", label: "节流" },
                  ]}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      strategy: event.target.value as RouteGroup["strategy"],
                    })
                  }
                />
              </Field>
              <label className="model-access-check model-access-route-sticky">
                <input
                  type="checkbox"
                  checked={draft.sticky === true}
                  onChange={(event) =>
                    setDraft({ ...draft, sticky: event.target.checked })
                  }
                />
                黏性
              </label>
            </div>
            <div className="model-access-rows">
              {draft.members.map((member, index) => {
                const source = sources.find(
                  (item) => item.id === member.sourceId,
                );
                const models = catalogs[member.sourceId] ?? [];
                const listId = `route-models-${draft.id}-${index}`;
                return (
                  <div
                    className="model-access-route-member"
                    key={`${member.sourceId}-${index}`}
                  >
                    <Field id={`route-source-${index}`} label="来源">
                      <Select
                        id={`route-source-${index}`}
                        aria-label="路由成员来源"
                        value={member.sourceId}
                        options={[
                          { value: "", label: "选择来源" },
                          ...sources.map((item) => ({
                            value: item.id,
                            label: item.label,
                          })),
                        ]}
                        onChange={(event) =>
                          patchMember(index, {
                            sourceId: event.target.value,
                            model: "",
                            credentialId: undefined,
                          })
                        }
                      />
                    </Field>
                    <Field id={`route-model-${index}`} label="模型">
                      <Input
                        id={`route-model-${index}`}
                        aria-label="路由成员模型"
                        list={listId}
                        value={member.model}
                        placeholder="模型 ID"
                        onChange={(event) =>
                          patchMember(index, { model: event.target.value })
                        }
                      />
                      <datalist id={listId}>
                        {models.map((entry) => (
                          <option key={entry.id} value={entry.id} />
                        ))}
                        {source?.model && <option value={source.model} />}
                      </datalist>
                    </Field>
                    <Field id={`route-credential-${index}`} label="凭据">
                      <Select
                        id={`route-credential-${index}`}
                        aria-label="路由成员凭据"
                        value={member.credentialId ?? ""}
                        options={[
                          { value: "", label: "默认凭据" },
                          ...(source?.credentials ?? []).map((credential) => ({
                            value: credential.id,
                            label: credential.label,
                          })),
                        ]}
                        onChange={(event) =>
                          patchMember(index, {
                            credentialId: event.target.value || undefined,
                          })
                        }
                      />
                    </Field>
                    <label className="model-access-check">
                      <input
                        type="checkbox"
                        checked={member.enabled !== false}
                        aria-label="启用路由成员"
                        onChange={(event) =>
                          patchMember(index, { enabled: event.target.checked })
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      className="model-access-icon-button"
                      aria-label="删除路由成员"
                      disabled={draft.members.length <= 1}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          members: draft.members.filter(
                            (_, at) => at !== index,
                          ),
                        })
                      }
                    >
                      <Trash size={14} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={14} />}
                onClick={() =>
                  setDraft({
                    ...draft,
                    members: [
                      ...draft.members,
                      { sourceId: "", model: "", enabled: true },
                    ],
                  })
                }
              >
                添加成员
              </Button>
            </div>
            {error && (
              <span className="model-access-status is-error" role="alert">
                {error}
              </span>
            )}
            <div className="provider-actions">
              <Button
                size="sm"
                icon={<FloppyDisk size={15} />}
                loading={busy}
                onClick={() => void save()}
              >
                保存路由组
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                取消
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function ProviderAttemptNote({
  sessionId,
  events,
  routeGroupId,
  routeGroupLabel,
}: {
  readonly sessionId: string | null | undefined;
  readonly events: readonly AgentEvent[] | undefined;
  readonly routeGroupId: string | undefined;
  readonly routeGroupLabel: string | undefined;
}) {
  type AttemptSelection = Extract<
    AgentEvent,
    { type: "provider_attempt" }
  >["selection"];
  const [latest, setLatest] = useState<AttemptSelection | undefined>(undefined);
  useEffect(() => {
    let found: AttemptSelection | undefined;
    for (const event of [...(events ?? [])].reverse()) {
      if (event.type !== "provider_attempt") continue;
      found = event.selection;
      break;
    }
    setLatest(found);
  }, [events, sessionId]);
  useEffect(() => {
    if (!sessionId || !window.forge.onEvent) return;
    return window.forge.onEvent((runEvent) => {
      if (runEvent.event.sessionId !== sessionId) return;
      if (runEvent.event.type !== "provider_attempt") return;
      setLatest(runEvent.event.selection);
    });
  }, [sessionId]);
  if (!latest) return null;
  const outcome =
    latest.outcome === "succeeded"
      ? "成功"
      : latest.outcome === "failed"
        ? `失败${latest.errorCode ? ` · ${latest.errorCode}` : ""}`
        : "请求中";
  return (
    <div className="composer-provider-attempt" aria-live="polite">
      {routeGroupId && <span>选择 {routeGroupLabel ?? routeGroupId}</span>}
      <span>
        实际 {latest.sourceId}/{latest.model} ·{" "}
        {latest.credentialId ?? "默认凭据"} · {outcome}
      </span>
    </div>
  );
}
