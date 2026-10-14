import { FileCode } from "@phosphor-icons/react";
import type { FileChange } from "../../shared-types";
import "./code-diff.css";

export interface DiffViewerProps {
  readonly change?: FileChange;
  readonly path?: string;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly isSuggested?: boolean;
  readonly truncated?: boolean;
  readonly className?: string;
}

interface DiffLineItem {
  readonly type: "neutral" | "added" | "removed";
  readonly beforeNumber?: number;
  readonly afterNumber?: number;
  readonly text: string;
}

function computeSimpleDiff(
  before: string | null,
  after: string | null,
): { readonly lines: readonly DiffLineItem[]; readonly truncated: boolean } {
  const beforeLines = (before ?? "").split("\n");
  const afterLines = (after ?? "").split("\n");

  if (before === null) {
    const lines = afterLines.slice(0, 500).map((line, idx) => ({
      type: "added" as const,
      afterNumber: idx + 1,
      text: line,
    }));
    return { lines, truncated: afterLines.length > lines.length };
  }

  if (after === null) {
    const lines = beforeLines.slice(0, 500).map((line, idx) => ({
      type: "removed" as const,
      beforeNumber: idx + 1,
      text: line,
    }));
    return { lines, truncated: beforeLines.length > lines.length };
  }

  // Simple diff algorithm for display
  const items: DiffLineItem[] = [];

  let bIdx = 0;
  let aIdx = 0;

  while (bIdx < beforeLines.length || aIdx < afterLines.length) {
    const bLine = beforeLines[bIdx];
    const aLine = afterLines[aIdx];

    if (bLine !== undefined && aLine !== undefined) {
      if (bLine === aLine) {
        items.push({
          type: "neutral",
          beforeNumber: bIdx + 1,
          afterNumber: aIdx + 1,
          text: bLine,
        });
        bIdx++;
        aIdx++;
      } else {
        // Line changed
        items.push({
          type: "removed",
          beforeNumber: bIdx + 1,
          text: bLine,
        });
        items.push({
          type: "added",
          afterNumber: aIdx + 1,
          text: aLine,
        });
        bIdx++;
        aIdx++;
      }
    } else if (bLine !== undefined) {
      items.push({
        type: "removed",
        beforeNumber: bIdx + 1,
        text: bLine,
      });
      bIdx++;
    } else if (aLine !== undefined) {
      items.push({
        type: "added",
        afterNumber: aIdx + 1,
        text: aLine,
      });
      aIdx++;
    } else {
      break;
    }
    if (items.length >= 500) break; // bounded
  }

  return {
    lines: items.slice(0, 500),
    truncated:
      items.length > 500 ||
      bIdx < beforeLines.length ||
      aIdx < afterLines.length,
  };
}

export function DiffViewer({
  change,
  path = change?.path ?? "unknown-file.ts",
  before = change?.before ?? null,
  after = change?.after ?? null,
  isSuggested = true,
  truncated = change?.truncated ?? false,
  className = "",
}: DiffViewerProps) {
  const diff = computeSimpleDiff(before, after);
  const lines = diff.lines;

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
        <div>
          {isSuggested ? (
            <span className="diff-badge-suggested">建议差异</span>
          ) : (
            <span className="diff-badge-applied">已应用差异</span>
          )}
        </div>
      </div>
      <div className="diff-scroll">
        <div
          style={{ display: "flex", flexDirection: "column", width: "100%" }}
        >
          {lines.map((item) => {
            const key = `${item.type}-${item.beforeNumber ?? 0}-${item.afterNumber ?? 0}`;
            const marker =
              item.type === "added" ? "+" : item.type === "removed" ? "-" : " ";
            const lineClass =
              item.type === "added"
                ? "diff-line-added"
                : item.type === "removed"
                  ? "diff-line-removed"
                  : "diff-line-neutral";

            return (
              <div key={key} className={`diff-line ${lineClass}`}>
                <span className="diff-line-number">
                  {item.beforeNumber ?? ""}
                </span>
                <span className="diff-line-number">
                  {item.afterNumber ?? ""}
                </span>
                <span className="diff-marker">{marker}</span>
                <span className="diff-content">{item.text || " "}</span>
              </div>
            );
          })}
        </div>
      </div>
      {(truncated || diff.truncated) && (
        <div className="diff-truncated-notice">
          提示：文件差异内容过大，已截断显示。
        </div>
      )}
    </section>
  );
}
