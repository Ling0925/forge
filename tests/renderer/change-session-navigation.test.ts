import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeSessionNavigation } from "../../src/renderer/components/workbench/ChangeSessionNavigation";
import type { SessionSummary } from "../../src/renderer/shared-types";
import {
  initialWorkbenchState,
  workbenchReducer,
} from "../../src/renderer/state/workbench-reducer";
import { sessionIdSchema } from "../../src/shared/schemas";

const parentId = sessionIdSchema.parse("11111111-1111-4111-8111-111111111111");
const childId = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const child: SessionSummary = {
  version: 1,
  id: childId,
  parentSessionId: parentId,
  title: "Invoice implementation",
  model: "provider/model",
  workspace: "/tmp/project",
  status: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
};
const render = (
  sessions: readonly SessionSummary[],
  sessionId = parentId,
  parentSessionId?: typeof parentId,
) =>
  renderToStaticMarkup(
    createElement(ChangeSessionNavigation, {
      sessions,
      sessionId,
      parentSessionId,
      onOpenChanges: () => {},
    }),
  );

describe("delegated change navigation", () => {
  it("shows actual related session provenance without claiming file changes", () => {
    const html = render([
      child,
      {
        ...child,
        id: parentId,
        parentSessionId: undefined,
        title: "Unrelated session",
      },
    ]);
    expect(html).toContain(child.title);
    expect(html).toContain(child.model);
    expect(html).toContain(childId);
    expect(html).toContain('aria-label="状态：完成"');
    expect(html).toContain("打开此子任务的变更 / 检查点");
    expect(html).toContain("不表示每个子任务都有文件变更");
    expect(html).not.toContain("Unrelated session");
  });
  it("clamps long titles while retaining full tooltip and expandable text", () => {
    const title = "真实子任务标题与实施要求".repeat(24);
    const html = render([{ ...child, title }]);
    expect(html).toContain(
      `class="child-title-clamp" title="${title}" aria-label="${title}"`,
    );
    expect(html).toContain("<summary>查看完整子任务标题</summary>");
    expect(html).toContain(`<p class="message-body">${title}</p>`);
    expect(html).toContain(child.model);
    expect(html).toContain(childId);
    expect(html).toContain("打开此子任务的变更 / 检查点");
  });
  it("bounds the first page and retains pagination to all persisted children", () => {
    const html = render(
      Array.from({ length: 7 }, (_, i) => ({
        ...child,
        id: sessionIdSchema.parse(
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
        title: `Child ${i}`,
      })),
    );
    expect(html.match(/打开此子任务的变更/g)).toHaveLength(5);
    expect(html).toContain("下一页子任务");
    expect(html).toContain("Child 4");
    expect(html).not.toContain("Child 5");
  });
  it("offers an explicit parent return path from the child's changes section", () => {
    const html = render([child], childId, parentId);
    expect(html).toContain("返回父任务的变更 / 检查点");
    expect(html).toContain(parentId);
    expect(html).not.toContain("打开此子任务");
  });
  it("selection clears the old snapshot so child inspection cannot use parent changes", () => {
    const selected = workbenchReducer(
      { ...initialWorkbenchState, activeSessionId: parentId },
      { type: "SELECT_SESSION", sessionId: childId },
    );
    expect(selected.activeSessionId).toBe(childId);
    expect(selected.activeSnapshot).toBeNull();
    expect(selected.isSnapshotLoading).toBe(true);
  });
});
