import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StoredTranscript } from "../../src/renderer/components/workbench/Transcript";
import { sessionSnapshotSchema } from "../../src/shared/schemas";

it("collapses only tagged internal messages while preserving identical human text", () => {
  const content = '子代理汇总：{"result":"real persisted evidence"}';
  const snapshot = sessionSnapshotSchema.parse({
    version: 1,
    id: "11111111-1111-4111-8111-111111111111",
    title: "test",
    workspace: "/tmp",
    model: "m",
    status: "completed",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    messages: [
      { role: "user", origin: "agent_reconciliation", content },
      { role: "user", content },
    ],
    events: [],
    changes: [],
  });
  const html = renderToStaticMarkup(
    createElement(StoredTranscript, { snapshot }),
  );
  expect(html).toContain(
    '<details class="message message-internal"><summary>子代理汇总 · 内部记录</summary>',
  );
  expect(html).not.toContain(" open=");
  expect(html).toContain(
    '<article class="message message-user"><div class="message-header">你</div>',
  );
  expect(html.match(/real persisted evidence/g)).toHaveLength(2);
});
