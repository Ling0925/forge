import { DownloadSimple, Eye, FileText } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  PUBLISHED_PREVIEW_MAX_BYTES, publishedFileResponseSchema,
  type PublishedFile,
} from "../../../shared/published-files";
import type { SessionId } from "../../shared-types";
import { Button } from "../primitives/Button";
import { HtmlPreview } from "../primitives/HtmlPreview";
import { Dialog } from "./Dialog";
import "./published-files.css";

const rasterTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export function fileSize(size: number): string {
  return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function PublishedFileCard({ sessionId, file }: { readonly sessionId: SessionId; readonly file: PublishedFile }) {
  const image = file.previewKind === "image" && rasterTypes.has(file.mimeType);
  const textPreview = (file.previewKind === "text" || file.previewKind === "html") && file.size <= PUBLISHED_PREVIEW_MAX_BYTES;
  const [imageUrl, setImageUrl] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const pending = useRef<Promise<Uint8Array> | undefined>(undefined);
  const urls = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const load = useCallback(() => {
    if (!pending.current) {
      pending.current = (async () => {
        if (typeof window.forge?.getPublishedFile !== "function") throw new Error("此宿主尚不支持附件，请更新后重试。");
        const response = publishedFileResponseSchema.parse(await window.forge.getPublishedFile(sessionId, file.id));
        if (response.file.id !== file.id || response.file.sha256 !== file.sha256 || response.file.size !== file.size)
          throw new Error("附件与会话记录不匹配。");
        const bytes = Uint8Array.from(atob(response.base64), char => char.charCodeAt(0));
        if (bytes.length !== file.size) throw new Error("附件内容不完整。");
        return bytes;
      })().catch(cause => { pending.current = undefined; throw cause; });
    }
    return pending.current;
  }, [sessionId, file.id, file.sha256, file.size]);
  useEffect(() => {
    active.current = true;
    if (image) {
      void load().then(bytes => {
        if (!active.current) return;
        // Desktop CSP deliberately disallows blob subresources; raster data URLs
        // already have a safe img-src allowance and never grant document access.
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        setImageUrl(`data:${file.mimeType};base64,${btoa(binary)}`);
      }).catch(cause => { if (active.current) setError(cause instanceof Error ? cause.message : "图片加载失败。"); });
    }
    const allocated = urls.current;
    const scheduled = timers.current;
    return () => {
      active.current = false;
      for (const timer of scheduled) clearTimeout(timer);
      scheduled.clear();
      for (const url of allocated) URL.revokeObjectURL(url);
      allocated.clear();
    };
  }, [image, file.mimeType, load]);

  async function act(download: boolean) {
    setBusy(true);
    setError("");
    try {
      if (download && typeof window.forge.savePublishedFile === "function") {
        await window.forge.savePublishedFile(sessionId, file.id);
        return;
      }
      const bytes = await load();
      if (!active.current) return;
      if (download) {
        // Always download as opaque bytes: HTML/SVG must never become a navigable document.
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
        urls.current.add(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        document.body.append(link);
        link.click();
        link.remove();
        const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); timers.current.delete(timer); }, 30000);
        timers.current.add(timer);
      } else if (image || textPreview) {
        if (textPreview) setText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        setOpen(true);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "附件加载失败，请重试。");
    } finally { if (active.current) setBusy(false); }
  }
  return (
    <article className="published-file" aria-label={`附件 ${file.name}`}>
      {image && imageUrl ? <button type="button" className="published-file-thumb" onClick={() => void act(false)} aria-label={`预览 ${file.name}`}>
        <img src={imageUrl} alt={file.name} loading="lazy" onError={() => { setImageUrl(""); setError("图片无法解码，仍可下载原文件。"); }} />
      </button> : <FileText size={28} className="published-file-icon" aria-hidden="true" />}
      <div className="published-file-info">
        <strong className="published-file-name" title={file.name}>{file.name}</strong>
        <span className="wb-muted">{fileSize(file.size)} · 已保存快照</span>
        {file.description && <p>{file.description}</p>}
        {!image && !textPreview && <span className="wb-muted">{file.previewKind === "text" || file.previewKind === "html" ? "超过 1 MiB，请下载查看" : "此格式支持下载"}</span>}
        <div className="published-file-actions">
          {(image || textPreview) && <Button variant="ghost" size="sm" disabled={busy} icon={<Eye size={14} />} onClick={() => void act(false)}>预览</Button>}
          <Button variant="ghost" size="sm" disabled={busy} icon={<DownloadSimple size={14} />} onClick={() => void act(true)}>{busy ? "正在读取…" : "下载"}</Button>
        </div>
        {error && <p className="published-file-error" role="alert">{error}</p>}
      </div>
      {open && <Dialog title={`文件预览 · ${file.name}`} onClose={() => setOpen(false)} initialFocus=".modal-close">
        {image ? <img className="published-file-full-image" src={imageUrl} alt={file.name} /> : <>
          {file.previewKind === "html" && <HtmlPreview html={text} label="隔离渲染 HTML" />}
          <pre className="published-file-text">{text}</pre>
          <p className="wb-muted">纯文本预览，不执行文件内容。HTML 可在支持的宿主中隔离渲染。</p>
        </>}
      </Dialog>}
    </article>
  );
}

/** Kept outside the execution disclosure so delivered files remain visible after completion. */
export function PublishedFiles({ sessionId, files }: { readonly sessionId: SessionId; readonly files: readonly PublishedFile[] }) {
  if (!files.length) return null;
  return <section className="published-files" aria-label="Forge 交付的文件">
    {files.map(file => <PublishedFileCard key={`${sessionId}:${file.id}`} sessionId={sessionId} file={file} />)}
  </section>;
}
