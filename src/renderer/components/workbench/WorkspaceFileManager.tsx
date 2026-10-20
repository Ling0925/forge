import {
  ArrowClockwise,
  ArrowUpLeft,
  FileCode,
  FileText,
  Folder,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { isHtmlPath } from "../../../shared/html-preview";
import type {
  WorkspaceDirectoryListingDto,
  WorkspaceFileEntryDto,
  WorkspaceFilePreviewDto,
} from "../../../shared/ipc";
import type {
  AgentEvent,
  FileChange,
  SessionSnapshot,
} from "../../../shared/schemas";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { HtmlPreview } from "../primitives/HtmlPreview";

function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function changeKindMeta(kind: FileChange["kind"]): {
  readonly label: string;
  readonly className: string;
} {
  if (kind === "created") return { label: "新增", className: "kind-added" };
  if (kind === "deleted") return { label: "已删", className: "kind-deleted" };
  return { label: "已改", className: "kind-modified" };
}

function extractPatchPreviewText(change: FileChange | undefined): string {
  if (!change?.patch) return "";
  return change.patch.hunks
    .flatMap((hunk) =>
      hunk.lines
        .filter((line) => line.op !== "delete")
        .map((line) => line.text),
    )
    .join("\n");
}

function buildFallbackListing(
  session: SessionSnapshot,
  liveEvents: readonly AgentEvent[],
  currentPath: string,
): WorkspaceDirectoryListingDto {
  const knownFiles = new Map<string, { sizeBytes?: number }>();
  for (const change of session.changes) {
    if (change.kind === "deleted") continue;
    const normalized = change.path.replace(/^\.\/+/, "").replace(/\\/g, "/");
    if (!normalized || normalized === ".") continue;
    const text = extractPatchPreviewText(change);
    knownFiles.set(normalized, {
      ...(text.length > 0 ? { sizeBytes: text.length } : {}),
    });
  }
  for (const event of [...session.events, ...liveEvents]) {
    if (event.type !== "tool_started") continue;
    try {
      const parsed: unknown = JSON.parse(event.call.function.arguments);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "path" in parsed &&
        typeof parsed.path === "string"
      ) {
        const normalized = parsed.path
          .replace(/^\.\/+/, "")
          .replace(/\\/g, "/")
          .trim();
        if (normalized && normalized !== "." && !normalized.startsWith("..")) {
          if (!knownFiles.has(normalized)) {
            knownFiles.set(normalized, {});
          }
        }
      }
    } catch {
      // Ignore malformed tool arguments.
    }
  }

  const normalizedDir =
    currentPath === "." ? "" : currentPath.replace(/\/+$/, "");
  const prefix = normalizedDir ? `${normalizedDir}/` : "";
  const subdirs = new Set<string>();
  const files: WorkspaceFileEntryDto[] = [];

  for (const [filePath, meta] of knownFiles) {
    if (!filePath.startsWith(prefix)) continue;
    const rest = filePath.slice(prefix.length);
    if (!rest) continue;
    const slashIndex = rest.indexOf("/");
    if (slashIndex !== -1) {
      const dirName = rest.slice(0, slashIndex);
      if (dirName) subdirs.add(dirName);
    } else {
      files.push({
        name: rest,
        path: filePath,
        kind: "file",
        ...(meta.sizeBytes !== undefined ? { sizeBytes: meta.sizeBytes } : {}),
      });
    }
  }

  const dirEntries: WorkspaceFileEntryDto[] = [...subdirs]
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
    .map((name) => ({
      name,
      path: prefix ? `${prefix}${name}` : name,
      kind: "directory" as const,
    }));

  files.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));

  const lastSlash = normalizedDir.lastIndexOf("/");
  const parentPath =
    currentPath === "."
      ? null
      : lastSlash === -1
        ? "."
        : normalizedDir.slice(0, lastSlash);

  return {
    workspace: session.workspace,
    path: currentPath,
    parentPath,
    entries: [...dirEntries, ...files],
    truncated: false,
  };
}

export interface WorkspaceFileManagerProps {
  readonly session: SessionSnapshot;
  readonly liveEvents: readonly AgentEvent[];
  readonly active?: boolean;
  readonly onSelectChangesTab?: () => void;
}

export function WorkspaceFileManager({
  session,
  liveEvents,
  active = true,
  onSelectChangesTab,
}: WorkspaceFileManagerProps): ReactElement {
  const [currentPath, setCurrentPath] = useState<string>(".");
  const [filterText, setFilterText] = useState<string>("");
  const [listing, setListing] = useState<WorkspaceDirectoryListingDto | null>(
    null,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState<number>(0);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filePreview, setFilePreview] =
    useState<WorkspaceFilePreviewDto | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Reset directory navigation when switching sessions
  useEffect(() => {
    setCurrentPath(".");
    setFilterText("");
    setListing(null);
    setError(null);
    setSelectedFile(null);
    setFilePreview(null);
    setPreviewError(null);
  }, [session.id]);

  const changesByPath = useMemo(() => {
    const map = new Map<string, FileChange>();
    for (const change of session.changes) {
      const normalized = change.path.replace(/^\.\/+/, "").replace(/\\/g, "/");
      map.set(normalized, change);
    }
    return map;
  }, [session.changes]);

  const loadDirectory = useCallback(
    async (targetPath: string, isCancelled: () => boolean) => {
      if (typeof window.forge?.listWorkspaceEntries !== "function") {
        const fallback = buildFallbackListing(session, liveEvents, targetPath);
        if (!isCancelled()) {
          setListing(fallback);
          setLoading(false);
          setError(null);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await window.forge.listWorkspaceEntries(
          session.id,
          targetPath,
        );
        if (!isCancelled()) {
          setListing(result);
        }
      } catch (err) {
        if (!isCancelled()) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!isCancelled()) {
          setLoading(false);
        }
      }
    },
    [session, liveEvents],
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadDirectory(currentPath, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [active, currentPath, refreshTick, loadDirectory]);

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      if (selectedFile === filePath && filePreview?.path === filePath) {
        setSelectedFile(null);
        setFilePreview(null);
        setPreviewError(null);
        return;
      }
      setSelectedFile(filePath);
      setPreviewError(null);

      if (typeof window.forge?.readWorkspaceFile !== "function") {
        const change = changesByPath.get(filePath);
        const content = extractPatchPreviewText(change);
        setFilePreview({
          path: filePath,
          sizeBytes: content.length,
          content,
          truncated: false,
          binary: false,
        });
        return;
      }

      setPreviewLoading(true);
      try {
        const preview = await window.forge.readWorkspaceFile(
          session.id,
          filePath,
        );
        setFilePreview(preview);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
        setFilePreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [selectedFile, filePreview, changesByPath, session.id],
  );

  const breadcrumbs = useMemo(() => {
    const activePath = listing?.path ?? currentPath;
    if (!activePath || activePath === ".") {
      return [{ label: "根目录", path: "." }];
    }
    const parts = activePath.split("/").filter(Boolean);
    const items: { label: string; path: string }[] = [
      { label: "根目录", path: "." },
    ];
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      items.push({ label: part, path: acc });
    }
    return items;
  }, [listing?.path, currentPath]);

  const filteredEntries = useMemo(() => {
    const entries = listing?.entries ?? [];
    const query = filterText.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(query));
  }, [listing?.entries, filterText]);

  return (
    <div className="inspector-file-manager">
      <div className="inspector-card inspector-file-manager-header-card">
        <div className="inspector-card-header">
          <span className="inspector-card-title">工作区文件</span>
          <div className="inspector-file-manager-actions">
            {currentPath !== "." ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const parent = listing?.parentPath ?? ".";
                  setCurrentPath(parent);
                }}
                aria-label="返回上级目录"
              >
                <ArrowUpLeft size={13} aria-hidden="true" />
                上级
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              loading={loading}
              onClick={() => setRefreshTick((tick) => tick + 1)}
              aria-label="刷新目录"
            >
              <ArrowClockwise size={13} aria-hidden="true" />
              刷新
            </Button>
          </div>
        </div>

        <div
          className="inspector-file-workspace-root mono"
          title={session.workspace}
        >
          {session.workspace}
        </div>

        <nav
          className="inspector-file-breadcrumbs"
          aria-label="工作区目录路径"
        >
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <span key={crumb.path} className="inspector-file-breadcrumb-item">
                {index > 0 ? (
                  <span
                    className="inspector-file-breadcrumb-sep"
                    aria-hidden="true"
                  >
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  className={`inspector-file-breadcrumb-btn${isLast ? " is-current" : ""}`}
                  onClick={() => setCurrentPath(crumb.path)}
                  aria-current={isLast ? "location" : undefined}
                >
                  {crumb.label}
                </button>
              </span>
            );
          })}
        </nav>

        <div className="inspector-file-filter-row">
          <MagnifyingGlass
            size={13}
            className="inspector-file-filter-icon"
            aria-hidden="true"
          />
          <input
            type="search"
            className="inspector-file-filter-input"
            placeholder="筛选当前目录文件..."
            aria-label="筛选当前目录文件"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          {filterText ? (
            <button
              type="button"
              className="inspector-file-filter-clear"
              onClick={() => setFilterText("")}
              aria-label="清空筛选"
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {error ? <ErrorState title="目录读取失败" error={error} /> : null}

      {selectedFile ? (
        <section
          className="inspector-card inspector-file-preview-card"
          aria-label={`文件预览 ${selectedFile}`}
        >
          <div className="inspector-card-header">
            <span className="inspector-file-preview-path mono">
              {selectedFile}
            </span>
            <div className="inspector-file-manager-actions">
              {filePreview?.sizeBytes !== undefined ? (
                <span className="inspector-meta-note mono">
                  {formatFileSize(filePreview.sizeBytes)}
                </span>
              ) : null}
              {isHtmlPath(selectedFile) ? (
                <HtmlPreview path={selectedFile} label="HTML 预览" />
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedFile(null);
                  setFilePreview(null);
                  setPreviewError(null);
                }}
              >
                收起预览
              </Button>
            </div>
          </div>
          {previewLoading ? (
            <p className="inspector-meta-note">正在读取文件内容…</p>
          ) : previewError ? (
            <ErrorState title="文件预览失败" error={previewError} />
          ) : filePreview ? (
            filePreview.binary ? (
              <p className="inspector-meta-note">
                二进制文件，不支持直接文本预览。
              </p>
            ) : (
              <>
                <pre className="inspector-file-preview-code mono">
                  {filePreview.content || "（空文件）"}
                </pre>
                {filePreview.truncated ? (
                  <p className="inspector-meta-note">
                    已截断显示前 64 KB 内容。
                  </p>
                ) : null}
              </>
            )
          ) : null}
        </section>
      ) : null}

      <div className="inspector-card inspector-file-tree-card">
        {loading && !listing ? (
          <p className="inspector-meta-note">正在加载目录条目…</p>
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            title={filterText ? "无匹配文件或目录" : "当前目录为空"}
            description={
              filterText
                ? "请尝试更换筛选关键词或返回上级目录。"
                : "当前工作区目录下没有可显示的文件。"
            }
          />
        ) : (
          <ul className="inspector-file-tree-list" aria-label="工作区文件列表">
            {filteredEntries.map((entry) => {
              const change = changesByPath.get(entry.path);
              const isSelected = selectedFile === entry.path;
              const isCode = /\.(?:ts|tsx|js|jsx|json|css|html|py|rs|go|sh|md|yml|yaml)$/i.test(
                entry.name,
              );
              return (
                <li key={entry.path} className="inspector-file-tree-item">
                  <button
                    type="button"
                    className={`inspector-file-tree-row${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      if (entry.kind === "directory") {
                        setCurrentPath(entry.path);
                        setFilterText("");
                      } else {
                        void handleOpenFile(entry.path);
                      }
                    }}
                  >
                    <span
                      className={`inspector-file-tree-icon is-${entry.kind}`}
                      aria-hidden="true"
                    >
                      {entry.kind === "directory" ? (
                        <Folder size={15} weight="fill" />
                      ) : isCode ? (
                        <FileCode size={15} />
                      ) : (
                        <FileText size={15} />
                      )}
                    </span>
                    <span className="inspector-file-tree-name">
                      {entry.name}
                    </span>
                    <span className="inspector-file-tree-meta">
                      {change ? (
                        <span
                          className={`inspector-file-kind ${changeKindMeta(change.kind).className}`}
                        >
                          {changeKindMeta(change.kind).label}
                        </span>
                      ) : null}
                      {entry.kind === "directory" ? (
                        <span className="inspector-file-tree-kind">目录</span>
                      ) : entry.sizeBytes !== undefined ? (
                        <span className="inspector-file-tree-size mono">
                          {formatFileSize(entry.sizeBytes)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {change && onSelectChangesTab ? (
                    <button
                      type="button"
                      className="inspector-file-tree-diff-btn"
                      onClick={() => onSelectChangesTab()}
                      title="查看此文件的会话变更 Diff"
                    >
                      Diff
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {listing?.truncated ? (
          <p className="inspector-meta-note">
            目录条目较多，仅展示前 {listing.entries.length} 项。
          </p>
        ) : null}
      </div>
    </div>
  );
}
