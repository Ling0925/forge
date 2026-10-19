import { ArrowUp, CaretDown, FolderOpen } from "@phosphor-icons/react";
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
          const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), summary',
          ) ?? []).filter((item) => item.getClientRects().length > 0);
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
        <div
          ref={panelRef}
          id={panelId}
          className="composer-project-panel workspace-picker-panel"
          role="dialog"
          aria-label={hostCapabilities.web ? "选择服务器工作区" : "选择工作区"}
          tabIndex={-1}
        >
          <div className="workspace-picker-heading">{hostCapabilities.web ? "服务器工作区" : "工作区"}</div>
          <p className="workspace-picker-helper">
            {restricted ? "此 Web 服务固定使用这个项目，不能切换目录。" : hostCapabilities.web
              ? "浏览 Forge 所在电脑上的文件夹，进入后点击“选择此目录”。"
              : "使用系统目录选择器选择项目文件夹。"}
          </p>
          {canBrowse ? (
            <>
              <div className="workspace-picker-toolbar">
                <Button type="button" size="sm" variant="ghost" disabled={loading || !page?.parent}
                  onClick={() => { if (page?.parent) void browse(page.parent); }}>
                  <ArrowUp size={14} aria-hidden="true" /> 上一级
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void browse()}>
                  默认目录
                </Button>
              </div>
              <output className="workspace-picker-path" aria-label="当前浏览目录">{page?.path ?? workspace}</output>
              <div className="workspace-picker-directories" aria-label="子目录" aria-busy={loading}>
                {loading && <p role="status">正在读取目录…</p>}
                {!loading && page?.directories.map((directory) => (
                  <button type="button" className="workspace-picker-directory" key={directory.path}
                    onClick={() => void browse(directory.path)}>
                    <FolderOpen size={16} aria-hidden="true" /><span>{directory.name}</span>
                  </button>
                ))}
                {!loading && page && page.directories.length === 0 && <p>没有可浏览的子目录，可直接选择此目录。</p>}
              </div>
              {page?.truncated && <p className="workspace-picker-helper">目录较多，仅显示部分结果；可使用下方路径跳转。</p>}
              <details className="workspace-picker-jump">
                <summary>通过路径跳转（可选）</summary>
                <label htmlFor={jumpId}>跳转到目录</label>
                <div className="composer-workspace-row">
                  <Input id={jumpId} value={jumpPath} onChange={(event) => setJumpPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (!loading && jumpPath.trim()) void browse(jumpPath.trim());
                      }
                    }} />
                  <Button type="button" size="sm" variant="ghost" disabled={loading || !jumpPath.trim()}
                    onClick={() => void browse(jumpPath.trim())}>跳转</Button>
                </div>
              </details>
            </>
          ) : <output className="workspace-picker-path">{workspace || "尚未选择目录"}</output>}
          {hostCapabilities.web && !restricted && !canBrowse && (
            <p role="alert">目录浏览不可用，请重启 Forge 服务并刷新页面。</p>
          )}
          {error && <p className="workspace-picker-error" role="alert">{error}</p>}
          <div className="workspace-picker-actions">
            <Button type="button" size="sm" variant="ghost" onClick={close}>{restricted ? "关闭" : "取消"}</Button>
            {canBrowse && <Button type="button" size="sm" disabled={loading || !page}
              onClick={() => {
                if (!page) return;
                onChange(page.path);
                setOpen(false);
                onDone();
              }}>选择此目录</Button>}
            {!hostCapabilities.web && <Button type="button" size="sm" disabled={loading} onClick={() => void selectNative()}>选择目录</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
