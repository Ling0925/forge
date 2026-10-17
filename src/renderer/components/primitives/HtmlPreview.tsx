import { ArrowsOut, Eye, SpinnerGap, X } from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  htmlPreviewAvailable,
  loadHtmlPreview,
} from "../../state/html-preview";
import { Button } from "./Button";
import "./html-preview.css";

export interface HtmlPreviewProps {
  /** Inline markup, e.g. a fenced ```html block. Mutually exclusive with `path`. */
  readonly html?: string;
  /** Workspace-relative HTML file, e.g. a changed `.html` file. */
  readonly path?: string;
  readonly label?: string;
  readonly className?: string;
}

/**
 * HTML preview for untrusted markup. The document is served by the host and
 * framed with `sandbox="allow-scripts"` only: without `allow-same-origin` the
 * frame gets an opaque origin, so it cannot read the workbench DOM, its
 * session cookie or workspace files. The host's document CSP additionally
 * forbids every network request.
 *
 * The component renders nothing when the host has no authenticated preview
 * endpoint (the desktop bridge), so the shared renderer stays usable there.
 */
export function HtmlPreview({
  html,
  path,
  label = "预览 HTML",
  className = "",
}: HtmlPreviewProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Reloading is a user action on an unchanged source, so it is tracked
  // separately from the source identity that invalidates a stale frame.
  const [reload, setReload] = useState(0);
  const titleId = useId();
  const ticket = useRef(0);
  const identity = path ? `file:${path}` : `inline:${html?.length ?? 0}`;

  const load = useCallback(async () => {
    const current = ++ticket.current;
    setLoading(true);
    setError("");
    try {
      const preview = await loadHtmlPreview(
        path ? { kind: "file", path } : { kind: "inline", html: html ?? "" },
      );
      if (current !== ticket.current) return;
      setUrl(preview.url);
    } catch (err) {
      if (current !== ticket.current) return;
      setUrl("");
      setError(err instanceof Error ? err.message : "HTML 预览加载失败。");
    } finally {
      if (current === ticket.current) setLoading(false);
    }
  }, [html, path]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!htmlPreviewAvailable()) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={className}
        icon={<Eye size={14} weight="regular" />}
        onClick={() => setOpen(true)}
        aria-label={label}
      >
        {label}
      </Button>
      {open && (
        <HtmlPreviewDialog
          titleId={titleId}
          title={path ? `HTML 预览 · ${path}` : "HTML 预览"}
          onClose={() => setOpen(false)}
        >
          {loading && (
            <p className="html-preview-status">
              <SpinnerGap size={14} className="html-preview-spin" />
              正在准备预览…
            </p>
          )}
          {error && (
            <p className="html-preview-status html-preview-error" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && url && (
            <>
              <div className="html-preview-toolbar">
                <span className="html-preview-address" title={url}>
                  {url}
                </span>
                <span className="html-preview-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setReload((value) => value + 1)}
                  >
                    重新加载
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ArrowsOut size={13} weight="bold" />}
                    onClick={() =>
                      window.open(url, "_blank", "noopener,noreferrer")
                    }
                  >
                    新标签打开
                  </Button>
                </span>
              </div>
              <iframe
                key={`${identity}:${reload}`}
                className="html-preview-frame"
                title="HTML 预览"
                src={url}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
              />
            </>
          )}
          <p className="html-preview-note">
            在隔离沙箱中渲染：不读取会话与工作区文件，也不访问网络。脚本仅在本预览内运行。
          </p>
        </HtmlPreviewDialog>
      )}
    </>
  );
}

/** Local modal: the primitive layer must not depend on the workbench shell. */
function HtmlPreviewDialog({
  titleId,
  title,
  onClose,
  children,
}: {
  readonly titleId: string;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>(".html-preview-close")?.focus();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="html-preview-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      <header className="html-preview-header">
        <h2 id={titleId} className="html-preview-title">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="html-preview-close"
          onClick={onClose}
          aria-label="关闭 HTML 预览"
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
