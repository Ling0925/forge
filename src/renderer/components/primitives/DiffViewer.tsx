import { CaretRight, FileCode } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { FileChange } from "../../shared-types";
import "./code-diff.css";

/** A diff previews this many leading lines until the user expands it. */
export const DIFF_PREVIEW_LINES = 10;
/** Unchanged lines kept above and below each change in the preview fallback. */
export const DIFF_CONTEXT_LINES = 5;
/** Bound the rendered rows so a pathological diff cannot flood the DOM. */
const MAX_DIFF_ROWS = 2000;
/** Bound the fallback alignment work; larger regions degrade to a block. */
const LCS_CELL_LIMIT = 1_000_000;

type Patch = NonNullable<FileChange["patch"]>;

export interface DiffViewerProps {
  readonly change?: FileChange;
  readonly path?: string;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly isSuggested?: boolean;
  readonly truncated?: boolean;
  /** Leading lines shown while collapsed; 0 disables the preview. */
  readonly previewLines?: number;
  /** Unchanged context lines kept around each change (preview fallback only). */
  readonly contextLines?: number;
  readonly className?: string;
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

interface DiffRow {
  readonly type: "neutral" | "added" | "removed";
  readonly beforeNumber?: number;
  readonly afterNumber?: number;
  readonly text: string;
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
 * Added/removed line counts for a header summary. Prefers the recorded patch
 * (computed from full originals); falls back to the previews only when they are
 * complete. Returns null when the true counts are unknown.
 */
export function diffStats(
  change: FileChange,
): { readonly added: number; readonly removed: number } | null {
  const patch = change.patch;
  if (patch) {
    return patch.status !== "unavailable" &&
      patch.added !== undefined &&
      patch.removed !== undefined
      ? { added: patch.added, removed: patch.removed }
      : null;
  }
  if (change.truncated) return null;
  return previewStats(change.before, change.after);
}

function previewStats(
  before: string | null,
  after: string | null,
): { readonly added: number; readonly removed: number } | null {
  if (before === null && after === null) return { added: 0, removed: 0 };
  if (before === null) return { added: countLines(after ?? ""), removed: 0 };
  if (after === null) return { added: 0, removed: countLines(before ?? "") };
  const { rows } = alignLines(before.split("\n"), after.split("\n"));
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === "added") added += 1;
    else if (row.type === "removed") removed += 1;
  }
  return { added, removed };
}

function countLines(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
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
      const text = item.text.endsWith("\n")
        ? item.text.slice(0, -1)
        : item.text;
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
        ? "（精确差异不可用：内容超出计算预算）"
        : "（无文本改动）";
  return { lines, stats, empty, truncated };
}

/**
 * Line-level alignment for the preview fallback. A common prefix/suffix is
 * trimmed first so a local edit does not mark every following line as changed,
 * then the middle is aligned with a bounded LCS so an insertion stays one line.
 */
function alignLines(
  beforeLines: readonly string[],
  afterLines: readonly string[],
): { readonly rows: readonly DiffRow[]; readonly truncated: boolean } {
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  )
    start += 1;
  let endB = beforeLines.length;
  let endA = afterLines.length;
  while (
    endB > start &&
    endA > start &&
    beforeLines[endB - 1] === afterLines[endA - 1]
  ) {
    endB -= 1;
    endA -= 1;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i += 1)
    rows.push({
      type: "neutral",
      beforeNumber: i + 1,
      afterNumber: i + 1,
      text: beforeLines[i] ?? "",
    });

  const n = endB - start;
  const m = endA - start;
  let truncated = false;
  if (n > 0 || m > 0) {
    if (n * m <= LCS_CELL_LIMIT) {
      const width = m + 1;
      const dp = new Int32Array((n + 1) * width);
      const at = (i: number, j: number) => i * width + j;
      for (let i = n - 1; i >= 0; i -= 1)
        for (let j = m - 1; j >= 0; j -= 1)
          dp[at(i, j)] =
            beforeLines[start + i] === afterLines[start + j]
              ? (dp[at(i + 1, j + 1)] ?? 0) + 1
              : Math.max(dp[at(i + 1, j)] ?? 0, dp[at(i, j + 1)] ?? 0);
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (beforeLines[start + i] === afterLines[start + j]) {
          rows.push({
            type: "neutral",
            beforeNumber: start + i + 1,
            afterNumber: start + j + 1,
            text: beforeLines[start + i] ?? "",
          });
          i += 1;
          j += 1;
        } else if ((dp[at(i + 1, j)] ?? 0) >= (dp[at(i, j + 1)] ?? 0)) {
          rows.push({
            type: "removed",
            beforeNumber: start + i + 1,
            text: beforeLines[start + i] ?? "",
          });
          i += 1;
        } else {
          rows.push({
            type: "added",
            afterNumber: start + j + 1,
            text: afterLines[start + j] ?? "",
          });
          j += 1;
        }
      }
      while (i < n) {
        rows.push({
          type: "removed",
          beforeNumber: start + i + 1,
          text: beforeLines[start + i] ?? "",
        });
        i += 1;
      }
      while (j < m) {
        rows.push({
          type: "added",
          afterNumber: start + j + 1,
          text: afterLines[start + j] ?? "",
        });
        j += 1;
      }
    } else {
      // Too large to align cheaply: show the changed block as one replacement.
      truncated = true;
      for (let i = 0; i < n; i += 1)
        rows.push({
          type: "removed",
          beforeNumber: start + i + 1,
          text: beforeLines[start + i] ?? "",
        });
      for (let j = 0; j < m; j += 1)
        rows.push({
          type: "added",
          afterNumber: start + j + 1,
          text: afterLines[start + j] ?? "",
        });
    }
  }

  for (let i = endB; i < beforeLines.length; i += 1)
    rows.push({
      type: "neutral",
      beforeNumber: i + 1,
      afterNumber: endA + (i - endB) + 1,
      text: beforeLines[i] ?? "",
    });
  return { rows, truncated };
}

/** Keep only the changes plus a bounded window of context around them. */
function withContext(
  rows: readonly DiffRow[],
  context: number,
): readonly DiffLineItem[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  let changed = false;
  rows.forEach((row, index) => {
    if (row.type !== "added" && row.type !== "removed") return;
    changed = true;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    for (let k = from; k <= to; k += 1) keep[k] = true;
  });
  if (!changed) return [];
  const items: DiffLineItem[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        items.push({ id: index, type: "gap", text: "", skipped });
        skipped = 0;
      }
      items.push({ id: index, ...row });
    } else skipped += 1;
  });
  return items;
}

/** Fallback model built from the (possibly truncated) before/after previews. */
function rowsFromPreview(
  before: string | null,
  after: string | null,
  context: number,
  sourceTruncated: boolean,
): DiffModel {
  const finish = (
    rows: readonly DiffRow[],
    alignTruncated: boolean,
  ): DiffModel => {
    const items = withContext(rows, context);
    const lines =
      items.length > MAX_DIFF_ROWS ? items.slice(0, MAX_DIFF_ROWS) : items;
    return {
      lines,
      stats: previewStats(before, after),
      empty:
        lines.length > 0
          ? null
          : sourceTruncated
            ? "（差异内容已截断，无法显示行级对比）"
            : "（无文本改动）",
      truncated:
        sourceTruncated || alignTruncated || items.length > MAX_DIFF_ROWS,
    };
  };

  if (before === null && after === null)
    return {
      lines: [],
      stats: { added: 0, removed: 0 },
      empty: null,
      truncated: false,
    };
  if (before === null)
    return finish(
      (after ?? "").split("\n").map((text, idx) => ({
        type: "added" as const,
        afterNumber: idx + 1,
        text,
      })),
      false,
    );
  if (after === null)
    return finish(
      (before ?? "").split("\n").map((text, idx) => ({
        type: "removed" as const,
        beforeNumber: idx + 1,
        text,
      })),
      false,
    );
  const { rows, truncated } = alignLines(before.split("\n"), after.split("\n"));
  return finish(rows, truncated);
}

export function DiffViewer({
  change,
  path = change?.path ?? "unknown-file.ts",
  before = change?.before ?? null,
  after = change?.after ?? null,
  isSuggested = true,
  truncated = change?.truncated ?? false,
  previewLines = DIFF_PREVIEW_LINES,
  contextLines = DIFF_CONTEXT_LINES,
  className = "",
}: DiffViewerProps) {
  // Prefer the recorded patch: it is computed from the full originals, so a
  // change beyond the 8192-character before/after preview is still shown. Only
  // fall back to the previews when no patch was recorded.
  const model = useMemo<DiffModel>(
    () =>
      change?.patch
        ? rowsFromPatch(change.patch)
        : rowsFromPreview(before, after, contextLines, truncated),
    [change, before, after, contextLines, truncated],
  );
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
      {(truncated && !change?.patch) || model.truncated ? (
        <div className="diff-truncated-notice">
          提示：文件差异内容过大，已截断显示。
        </div>
      ) : null}
    </section>
  );
}
