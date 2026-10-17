import { CaretRight, FileCode } from "@phosphor-icons/react";
import { useState } from "react";
import { isHtmlPath } from "../../../shared/html-preview";
import type { FileChange } from "../../shared-types";
import { HtmlPreview } from "./HtmlPreview";
import "./code-diff.css";

/** A diff previews this many leading lines until the user expands it. */
export const DIFF_PREVIEW_LINES = 10;

type Patch = NonNullable<FileChange["patch"]>;

export interface DiffViewerProps {
  readonly change?: FileChange;
  readonly path?: string;
  readonly isSuggested?: boolean;
  /** Leading lines shown while collapsed; 0 disables the preview. */
  readonly previewLines?: number;
  readonly className?: string;
  /**
   * Offer a preview of the resulting file. HTML paths are detected
   * automatically; set false to suppress it for a caller that knows the file
   * is not readable (for example a deleted file).
   */
  readonly previewHtml?: boolean;
}

interface DiffLineItem {
  readonly id: number;
  readonly type: "neutral" | "added" | "removed" | "gap";
  readonly beforeNumber?: number;
  readonly afterNumber?: number;
  readonly text: string;
  /** Only on gap rows: how many unchanged lines were skipped. */
  readonly skipped?: number;
}

interface DiffModel {
  readonly lines: readonly DiffLineItem[];
  /** Exact +/- counts when known, otherwise null (unknown, never assumed zero). */
  readonly stats: { readonly added: number; readonly removed: number } | null;
  /** Shown when there are no rows: a real no-op or an unavailable diff. */
  readonly empty: string | null;
  readonly truncated: boolean;
}

/**
 * Added/removed line counts for a header summary, taken from the recorded patch
 * (computed from the full originals). Returns null when the true counts are
 * unknown, so callers never report an unavailable diff as zero.
 */
export function diffStats(
  change: FileChange,
): { readonly added: number; readonly removed: number } | null {
  const patch = change.patch;
  if (
    patch &&
    patch.status !== "unavailable" &&
    patch.added !== undefined &&
    patch.removed !== undefined
  )
    return { added: patch.added, removed: patch.removed };
  return null;
}

/** Render the recorded patch hunks; each already carries its context window. */
function rowsFromPatch(patch: Patch): DiffModel {
  const lines: DiffLineItem[] = [];
  let id = 0;
  let previousOldEnd: number | undefined;
  for (const hunk of patch.hunks) {
    if (previousOldEnd !== undefined) {
      const skipped = hunk.oldStart - previousOldEnd;
      if (skipped > 0) lines.push({ id: id++, type: "gap", text: "", skipped });
    }
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const item of hunk.lines) {
      const text = item.text.endsWith("\n") ? item.text.slice(0, -1) : item.text;
      if (item.op === "delete") {
        lines.push({ id: id++, type: "removed", beforeNumber: oldLine, text });
        oldLine += 1;
      } else if (item.op === "insert") {
        lines.push({ id: id++, type: "added", afterNumber: newLine, text });
        newLine += 1;
      } else {
        lines.push({
          id: id++,
          type: "neutral",
          beforeNumber: oldLine,
          afterNumber: newLine,
          text,
        });
        oldLine += 1;
        newLine += 1;
      }
    }
    previousOldEnd = oldLine;
  }
  const stats =
    patch.added !== undefined && patch.removed !== undefined
      ? { added: patch.added, removed: patch.removed }
      : null;
  const truncated = patch.status === "truncated";
  const empty =
    lines.length > 0
      ? null
      : patch.status === "unavailable"
        ? patch.reason === "budget"
          ? "（精确差异不可用：内容超出计算预算）"
          : "（精确差异不可用：缺少完整内容）"
        : truncated
          ? "（差异内容已截断，无法显示行级对比）"
          : "（无文本改动）";
  return { lines, stats, empty, truncated };
}

const emptyModel = (): DiffModel => ({
  lines: [],
  stats: null,
  empty: "（无差异记录）",
  truncated: false,
});

export function DiffViewer({
  change,
  path = change?.path ?? "unknown-file.ts",
  isSuggested = true,
  previewLines = DIFF_PREVIEW_LINES,
  className = "",
  previewHtml = change?.kind !== "deleted",
}: DiffViewerProps) {
  const model: DiffModel = change?.patch
    ? rowsFromPatch(change.patch)
    : emptyModel();
  const [expanded, setExpanded] = useState(false);
  const lines = model.lines;
  const preview = previewLines > 0 ? previewLines : lines.length;
  const visible = expanded ? lines : lines.slice(0, preview);
  const hidden = lines.length - visible.length;
  const canExpand = lines.length > preview;

  return (
    <section
      className={`diff-viewer ${className}`.trim()}
      aria-label={`差异查看：${path}`}
    >
      <div className="diff-header">
        <div className="diff-path">
          <FileCode size={16} weight="regular" aria-hidden="true" />
          <span>{path}</span>
        </div>
        <div className="diff-header-meta">
          {isHtmlPath(path) && previewHtml && (
            <HtmlPreview
              path={path}
              label="预览 HTML"
              className="diff-preview-action"
            />
          )}
          {isSuggested ? (
            <span className="diff-badge-suggested">建议差异</span>
          ) : (
            <span className="diff-badge-applied">已应用差异</span>
          )}
        </div>
      </div>
      <div className={`diff-scroll${expanded ? " is-expanded" : ""}`}>
        <div
          style={{ display: "flex", flexDirection: "column", width: "100%" }}
        >
          {lines.length === 0 && (
            <div className="diff-line diff-line-neutral">
              <span className="diff-line-number" />
              <span className="diff-marker" />
              <span className="diff-content">
                {model.empty ?? "（无文本改动）"}
              </span>
            </div>
          )}
          {visible.map((item) => {
            if (item.type === "gap")
              return (
                <div key={item.id} className="diff-line diff-line-gap">
                  <span className="diff-line-number" />
                  <span className="diff-marker" />
                  <span className="diff-content">
                    ⋯ 已省略 {item.skipped} 行未改动内容 ⋯
                  </span>
                </div>
              );
            const marker =
              item.type === "added" ? "+" : item.type === "removed" ? "-" : " ";
            const lineClass =
              item.type === "added"
                ? "diff-line-added"
                : item.type === "removed"
                  ? "diff-line-removed"
                  : "diff-line-neutral";

            return (
              <div key={item.id} className={`diff-line ${lineClass}`}>
                <span className="diff-line-number">
                  {item.afterNumber ?? item.beforeNumber ?? ""}
                </span>
                <span className="diff-marker">{marker}</span>
                <span className="diff-content">{item.text || " "}</span>
              </div>
            );
          })}
        </div>
      </div>
      {canExpand && (
        <button
          type="button"
          className="diff-more"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          <CaretRight
            size={12}
            weight="bold"
            className={`diff-more-caret${expanded ? " is-expanded" : ""}`}
            aria-hidden="true"
          />
          {expanded ? "收起差异" : `展开全部差异（还有 ${hidden} 行）`}
        </button>
      )}
      {model.truncated && (
        <div className="diff-truncated-notice">
          提示：文件差异内容过大，已截断显示。
        </div>
      )}
    </section>
  );
}
