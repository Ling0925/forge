import {
  ArrowUp,
  CaretDown,
  CaretRight,
  FolderDashed,
  FolderOpen,
  House,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { WorkspaceDirectoryPage } from "../../../shared/workspaces";
import { hostCapabilities } from "../../web-host";
import { Button } from "../primitives/Button";
import { Input } from "../primitives/Input";
import "./workspace-picker.css";

export function WorkspacePicker({
  workspace,
  chooseWorkspace,
  onChange,
  onDone,
}: {
  readonly workspace: string;
  readonly chooseWorkspace: () => Promise<string | null>;
  readonly onChange: (path: string) => void;
  readonly onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<WorkspaceDirectoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jumpPath, setJumpPath] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const nativePending = useRef(false);
  const alive = useRef(true);
  const panelId = useId();
  const jumpId = useId();
  const restricted = hostCapabilities.web && window.forge.restrictWorkspace !== false;
  const canBrowse = hostCapabilities.web && !restricted && Boolean(window.forge.browseWorkspaces);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);

  const browse = useCallback(async (path?: string) => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const read = window.forge.browseWorkspaces;
      if (!read) throw new Error("目录浏览不可用，请重启 Forge 服务并刷新页面。");
      const result = await read(path);
      if (request !== generation.current || !alive.current) return;
      setPage(result);
      setJumpPath(result.path);
    } catch (cause) {
      if (request !== generation.current || !alive.current) return;
      setError(`无法读取目录，请选择其他目录或返回默认目录。${cause instanceof Error ? ` ${cause.message}` : ""}`);
    } finally {
      if (request === generation.current && alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    if (canBrowse) {
      setPage(null);
      void browse(workspace || undefined);
    }
    panelRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => {
      generation.current++;
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [open, canBrowse, workspace, browse]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectNative = async () => {
    if (nativePending.current) return;
    nativePending.current = true;
    setLoading(true);
    setError("");
    try {
      const path = await chooseWorkspace();
      if (!alive.current) return;
      if (path) {
        onChange(path);
        setOpen(false);
        onDone();
      }
    } catch (cause) {
      if (alive.current) {
        setError(cause instanceof Error ? cause.message : "选择目录失败，请重试。");
        setOpen(true);
      }
    } finally {
      nativePending.current = false;
      if (alive.current) setLoading(false);
    }
  };

  return (
    <div
      className="composer-project"
      ref={containerRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === "Tab" && open) {
          const items = Array.from(
            panelRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), summary',
            ) ?? [],
          ).filter((item) => item.getClientRects().length > 0);
          const first = items[0];
          const last = items.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="composer-project-trigger"
        title={workspace || "选择项目目录"}
        aria-label="选择工作区"
        aria-haspopup={hostCapabilities.web ? "dialog" : undefined}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={!hostCapabilities.web && loading}
        onClick={() => {
          if (hostCapabilities.web) setOpen(!open);
          else void selectNative();
        }}
      >
        <FolderOpen size={15} aria-hidden="true" />
        <span>{workspace ? workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace : "选择工作区"}</span>
        <CaretDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div
            className="workspace-picker-backdrop"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id={panelId}
            className="composer-project-panel workspace-picker-panel"
            role="dialog"
            aria-label={hostCapabilities.web ? "选择服务器工作区" : "选择工作区"}
            tabIndex={-1}
          >
            <div className="workspace-picker-header">
              <div className="workspace-picker-header-title">
                <div className="workspace-picker-icon-badge" aria-hidden="true">
                  <FolderOpen size={18} weight="duotone" />
                </div>
                <div className="workspace-picker-title-group">
                  <div className="workspace-picker-heading">
                    {hostCapabilities.web ? "服务器工作区" : "工作区"}
                  </div>
                  <p className="workspace-picker-helper">
                    {restricted
                      ? "此 Web 服务固定使用这个项目，不能切换目录。"
                      : hostCapabilities.web
                        ? "浏览 Forge 所在电脑上的文件夹，进入后点击“选择此目录”。"
                        : "使用系统目录选择器选择项目文件夹。"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="workspace-picker-close-btn"
                onClick={close}
                aria-label="关闭面板"
                title="关闭"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="workspace-picker-body">
              {canBrowse ? (
                <>
                  <div className="workspace-picker-nav">
                    <div className="workspace-picker-toolbar">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={loading || !page?.parent}
                        onClick={() => {
                          if (page?.parent) void browse(page.parent);
                        }}
                      >
                        <ArrowUp size={14} aria-hidden="true" /> 上一级
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={loading}
                        onClick={() => void browse()}
                      >
                        <House size={14} aria-hidden="true" /> 默认目录
                      </Button>
                    </div>

                    <div className="workspace-picker-path-box">
                      <FolderOpen size={14} className="workspace-picker-path-icon" aria-hidden="true" />
                      <output
                        className="workspace-picker-path"
                        aria-label="当前浏览目录"
                        title={page?.path ?? workspace}
                      >
                        {page?.path ?? workspace}
                      </output>
                    </div>
                  </div>

                  <div className="workspace-picker-directories-wrapper">
                    <div className="workspace-picker-directories-header">
                      <span>子文件夹</span>
                      {page && !loading && (
                        <span className="workspace-picker-dir-count">
                          {page.directories.length} 项
                        </span>
                      )}
                    </div>
                    <div className="workspace-picker-directories" aria-label="子目录" aria-busy={loading}>
                      {loading && (
                        <div className="workspace-picker-loading" role="status">
                          <SpinnerGap size={20} className="workspace-picker-spinner" aria-hidden="true" />
                          <span>正在读取目录…</span>
                        </div>
                      )}
                      {!loading &&
                        page?.directories.map((directory) => (
                          <button
                            type="button"
                            className="workspace-picker-directory"
                            key={directory.path}
                            onClick={() => void browse(directory.path)}
                            title={directory.path}
                          >
                            <div className="workspace-picker-dir-icon" aria-hidden="true">
                              <FolderOpen size={15} />
                            </div>
                            <span className="workspace-picker-dir-name">{directory.name}</span>
                            <CaretRight size={13} className="workspace-picker-dir-arrow" aria-hidden="true" />
                          </button>
                        ))}
                      {!loading && page && page.directories.length === 0 && (
                        <div className="workspace-picker-empty">
                          <div className="workspace-picker-empty-icon" aria-hidden="true">
                            <FolderDashed size={26} />
                          </div>
                          <p className="workspace-picker-empty-text">当前目录下无子文件夹</p>
                          <p className="workspace-picker-empty-hint">没有可浏览的子目录，可直接选择此目录。</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {page?.truncated && (
                    <div className="workspace-picker-truncated-notice">
                      <p className="workspace-picker-helper">目录较多，仅显示部分结果；可使用下方路径跳转。</p>
                    </div>
                  )}

                  <div className="workspace-picker-jump">
                    <label htmlFor={jumpId} className="workspace-picker-jump-label">跳转路径</label>
                    <div className="workspace-picker-jump-row">
                      <Input
                        id={jumpId}
                        value={jumpPath}
                        placeholder="输入或粘贴目录绝对路径…"
                        onChange={(event) => setJumpPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (!loading && jumpPath.trim()) void browse(jumpPath.trim());
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={loading || !jumpPath.trim()}
                        onClick={() => void browse(jumpPath.trim())}
                      >
                        跳转
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="workspace-picker-path-box">
                  <FolderOpen size={14} className="workspace-picker-path-icon" aria-hidden="true" />
                  <output className="workspace-picker-path">{workspace || "尚未选择目录"}</output>
                </div>
              )}

              {hostCapabilities.web && !restricted && !canBrowse && (
                <div className="workspace-picker-error-box" role="alert">
                  <p>目录浏览不可用，请重启 Forge 服务并刷新页面。</p>
                </div>
              )}

              {error && (
                <div className="workspace-picker-error-box" role="alert">
                  <p className="workspace-picker-error">{error}</p>
                </div>
              )}
            </div>

            <div className="workspace-picker-actions">
              <div className="workspace-picker-status-hint">
                {canBrowse && page?.path ? "将在选定目录中执行会话与指令" : ""}
              </div>
              <div className="workspace-picker-buttons">
                <Button type="button" size="sm" variant="ghost" onClick={close}>
                  {restricted ? "关闭" : "取消"}
                </Button>
                {canBrowse && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={loading || !page}
                    onClick={() => {
                      if (!page) return;
                      onChange(page.path);
                      setOpen(false);
                      onDone();
                    }}
                  >
                    选择此目录
                  </Button>
                )}
                {!hostCapabilities.web && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={loading}
                    onClick={() => void selectNative()}
                  >
                    选择目录
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
