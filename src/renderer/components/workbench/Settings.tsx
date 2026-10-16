import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  configureInputSchema,
  defaultPublicSettings,
  settingsFields,
} from "../../../shared/schemas";
import { useWorkbench } from "../../state/workbench-context";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Select } from "../primitives/Select";
import { Dialog } from "./Dialog";
import { ModelCatalog } from "./ModelCatalog";
export const permissionLabels = {
  readonly: "只读 · 不修改文件或执行命令",
  workspace: "工作区文件 · 命令逐次批准",
  unrestricted: "无限制 · 可执行命令（非 OS 沙箱）",
};
export function Settings() {
  const { state, updateSettings, openSettings } = useWorkbench();
  const initial = state.settings ?? defaultPublicSettings;
  const [draft, setDraft] = useState(initial);
  const dirty = useRef(false);
  const changeDraft: typeof setDraft = (next) => {
    dirty.current = true;
    setDraft(next);
  };
  const [key, setKey] = useState("");
  const [origins, setOrigins] = useState(
    initial.browserAllowedOrigins.join("\n"),
  );
  useEffect(() => {
    if (state.isSettingsOpen && !dirty.current && state.settings) {
      setDraft(state.settings);
      setOrigins(state.settings.browserAllowedOrigins.join("\n"));
    }
  }, [state.settings, state.isSettingsOpen]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<readonly string[]>([]);
  const [modelError, setModelError] = useState("");
  const [listing, setListing] = useState(false);
  const saving = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = async (close: boolean) => {
    if (saving.current) return false;
    setError("");
    const { hasApiKey: _has, isConfigured: _configured, ...settings } = draft;
    const parsed = configureInputSchema.safeParse({
      settings: {
        ...settings,
        browserAllowedOrigins: origins
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      ...(key ? { apiKey: key } : {}),
    });
    const required = z
      .object({
        baseUrl: settingsFields.baseUrl,
        model: close ? settingsFields.model : z.string(),
      })
      .safeParse(settings);
    if (!parsed.success || !required.success) {
      setError(
        (!parsed.success
          ? parsed.error
          : !required.success
            ? required.error
            : null
        )?.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n") ?? "检查设置",
      );
      return false;
    }
    setBusy(true);
    saving.current = true;
    let ok = false;
    try {
      ok = await updateSettings(parsed.data);
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : "保存失败，请重试。",
        );
      return false;
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
    if (!alive.current) return ok;
    setBusy(false);
    if (ok) {
      dirty.current = false;
      setKey("");
      if (close) openSettings(false);
    } else setError("保存失败。请检查工作台错误详情并重试。");
    return ok;
  };
  const list = async () => {
    if (listing) return;
    setListing(true);
    setModelError("");
    if (!(await save(false))) {
      if (alive.current) setListing(false);
      return;
    }
    try {
      const result = await window.forge.listModels();
      if (alive.current) setModels(result);
    } catch (err) {
      if (alive.current)
        setModelError(
          err instanceof Error
            ? err.message
            : "模型列表读取失败，可手动输入精确 ID",
        );
    } finally {
      if (alive.current) setListing(false);
    }
  };
  return (
    <Dialog
      open={state.isSettingsOpen}
      title="设置 · 模型与执行"
      dismissible={!busy && !listing}
      onClose={() => {
        if (!busy && !listing) openSettings(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
        className="settings-form"
      >
        <div className="modal-content settings-scroll">
          <fieldset disabled={busy || listing} className="settings-groups">
            <div className="settings-toolbar">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  dirty.current = false;
                  setDraft(state.settings ?? defaultPublicSettings);
                  setOrigins(
                    (
                      state.settings ?? defaultPublicSettings
                    ).browserAllowedOrigins.join("\n"),
                  );
                  setKey("");
                  setError("");
                  setModels([]);
                  setModelError("");
                }}
              >
                放弃未保存修改
              </Button>
            </div>
            <section
              className="settings-group"
              aria-labelledby="settings-connection"
            >
              <h3 className="settings-group-title" id="settings-connection">
                连接
              </h3>
              <Field
                id="endpoint"
                label="API 端点"
                helper="支持 HTTP LAN 与 HTTPS；网络请求由本地主机发起。"
              >
                <Input
                  id="endpoint"
                  value={draft.baseUrl}
                  onChange={(e) =>
                    changeDraft({ ...draft, baseUrl: e.target.value })
                  }
                  placeholder="http://localhost:8080/v1"
                />
              </Field>
              <Field id="api-mode" label="API 协议">
                <Select
                  id="api-mode"
                  value={draft.apiMode ?? "chat-completions"}
                  onChange={(e) =>
                    changeDraft({
                      ...draft,
                      apiMode: z
                        .enum(["chat-completions", "responses"])
                        .parse(e.target.value),
                    })
                  }
                  options={[
                    { value: "chat-completions", label: "Chat Completions" },
                    { value: "responses", label: "Responses" },
                  ]}
                />
              </Field>
              <Field
                id="api-key"
                label="API 密钥"
                helper={
                  initial.hasApiKey
                    ? "已保存密钥；留空保留，不显示原文。"
                    : "无已保存密钥；本地服务可留空。"
                }
              >
                <Input
                  id="api-key"
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  onChange={(e) => {
                    dirty.current = true;
                    setKey(e.target.value);
                  }}
                />
              </Field>
              <Field id="model" label="精确模型 ID">
                <Input
                  id="model"
                  value={draft.model}
                  onChange={(e) =>
                    changeDraft({ ...draft, model: e.target.value })
                  }
                />
              </Field>
              <Button size="sm" loading={listing} onClick={() => void list()}>
                保存并读取模型列表 / 重试
              </Button>
              {modelError && (
                <p role="alert" className="form-error">
                  {modelError}。仍可输入精确模型 ID。
                </p>
              )}
              {models.length > 0 && (
                <ModelCatalog
                  value={draft.model}
                  models={models}
                  onSelect={(model) => changeDraft({ ...draft, model })}
                  onRefresh={() => void list()}
                  loading={listing}
                  error=""
                />
              )}
            </section>
            <section
              className="settings-group settings-pair"
              aria-labelledby="settings-appearance"
            >
              <h3 className="settings-group-title" id="settings-appearance">
                外观与权限
              </h3>
              <Field id="theme" label="主题">
                <Select
                  id="theme"
                  value={draft.theme}
                  onChange={(e) => {
                    const theme = settingsFields.theme.parse(e.target.value);
                    changeDraft({ ...draft, theme });
                  }}
                  options={[
                    { value: "system", label: "跟随系统" },
                    { value: "dark", label: "深色" },
                    { value: "light", label: "浅色" },
                  ]}
                />
              </Field>
              <Field id="permission" label="默认权限">
                <Select
                  id="permission"
                  value={draft.defaultPermission}
                  onChange={(e) =>
                    changeDraft({
                      ...draft,
                      defaultPermission: settingsFields.defaultPermission.parse(
                        e.target.value,
                      ),
                    })
                  }
                  options={Object.entries(permissionLabels).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </Field>
            </section>
            <details className="settings-advanced">
              <summary>
                高级设置 <span>预算与浏览器</span>
              </summary>
              <section
                className="settings-group settings-pair"
                aria-labelledby="settings-limits"
              >
                <h3 className="settings-group-title" id="settings-limits">
                  预算
                </h3>
                {(
                  [
                    "requestTimeoutMs",
                    "maxTurns",
                    "maxToolCalls",
                    "contextBudgetChars",
                  ] as const
                ).map((name) => (
                  <Field
                    key={name}
                    id={name}
                    label={
                      {
                        requestTimeoutMs: "请求超时（毫秒）",
                        maxTurns: "最大轮次",
                        maxToolCalls: "工具调用预算",
                        contextBudgetChars: "上下文字符预算",
                      }[name]
                    }
                  >
                    <Input
                      id={name}
                      type="number"
                      value={draft[name]}
                      onChange={(e) =>
                        changeDraft({
                          ...draft,
                          [name]: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
              </section>
              <section
                className="settings-group"
                aria-labelledby="settings-browser"
              >
                <h3 className="settings-group-title" id="settings-browser">
                  浏览器
                </h3>
                <Field
                  id="origins"
                  label="浏览器允许来源"
                  helper="每行一个精确 origin，例如 http://localhost:3000；空列表禁止浏览器网络。"
                >
                  <textarea
                    className="form-textarea"
                    id="origins"
                    value={origins}
                    onChange={(e) => {
                      dirty.current = true;
                      setOrigins(e.target.value);
                    }}
                  />
                </Field>
                <Field
                  id="browser-path"
                  label="Chromium 可执行路径"
                  helper="可留空使用主机默认；不是 renderer 的浏览器连接。"
                >
                  <Input
                    id="browser-path"
                    value={draft.browserExecutablePath}
                    onChange={(e) =>
                      changeDraft({
                        ...draft,
                        browserExecutablePath: e.target.value,
                      })
                    }
                  />
                </Field>
              </section>
            </details>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </fieldset>
        </div>
        <footer className="modal-footer">
          <output className="wb-muted">
            {listing
              ? "正在读取模型…"
              : busy
                ? "正在保存…"
                : "关闭后保留未保存草稿"}
          </output>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={busy}
            disabled={listing}
          >
            保存设置
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
