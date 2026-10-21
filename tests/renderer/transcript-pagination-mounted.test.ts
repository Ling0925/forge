import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { expect, it } from "vitest";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

interface FakeWindow {
  calls: Array<{ readonly sessionId: string; readonly firstTurn: number }>;
  delay: number;
  failNextLoad: boolean;
  render: () => void;
  switchTo: (prefix: "A" | "B") => void;
  setShort: (prefix: "A" | "B", firstTurn: number) => void;
  controller: {
    state: {
      activeSessionId: string;
      activeSnapshot: unknown;
      isSnapshotLoading: boolean;
      isHistoryLoading: boolean;
      historyError: string | null;
      activeRuns: Record<string, never>;
    };
  };
}

async function openPage(browser: Browser, js: string, css: string) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  try {
    await page.locator(".workbench-conversation-scroll").waitFor();
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${errors.join("\n")}`,
    );
  }
  return { page, errors };
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as FakeWindow).calls.length);
const callLog = (page: Page) =>
  page.evaluate(() => (window as unknown as FakeWindow).calls);

it("windows transcript history on real upward intent, anchors the reader, and isolates sessions", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { Transcript } from "./src/renderer/components/workbench/Transcript";
        import "./src/renderer/styles/global.css";
        import "./src/renderer/components/workbench/app.css";
        import "./src/renderer/styles/workspace-theme.css";

        const A = "${SESSION_A}";
        const B = "${SESSION_B}";
        const START = Date.parse("2026-01-01T00:00:00.000Z");

        function buildTurns(prefix) {
          const messages = [];
          const events = [];
          const rows = [];
          const sessionId = prefix === "A" ? A : B;
          for (let turn = 1; turn <= 6; turn++) {
            const messageStart = messages.length;
            const eventStart = events.length;
            messages.push({ role: "user", content: prefix + " question " + turn });
            const lines = [];
            for (let line = 1; line <= 45; line++) {
              lines.push("- " + prefix + " line " + turn + "." + line + " keeps this row tall enough to scroll");
            }
            messages.push({
              role: "assistant",
              content: prefix + " answer " + turn + "\\n\\n" + lines.join("\\n"),
            });
            const timestamp = new Date(START + turn * 1000).toISOString();
            events.push({
              type: "run_started",
              sessionId,
              timestamp,
              turn,
              messageIndex: messageStart,
              model: "test/model",
              permission: "ask",
              prompt: prefix + " question " + turn,
            });
            events.push({
              type: "run_finished",
              sessionId,
              timestamp,
              turn,
              status: "completed",
              turns: 1,
              toolCalls: 0,
              retries: 0,
            });
            rows.push({
              turn,
              messageStart,
              eventStart,
              messageEnd: messages.length,
              eventEnd: events.length,
            });
          }
          return { messages, events, rows };
        }

        const dataA = buildTurns("A");
        const dataB = buildTurns("B");

        function makeSnapshot(prefix, firstTurn) {
          const data = prefix === "A" ? dataA : dataB;
          const row = data.rows[firstTurn - 1];
          const totalMessages = data.messages.length;
          const totalEvents = data.events.length;
          return {
            version: 1,
            id: prefix === "A" ? A : B,
            title: "Pagination " + prefix,
            workspace: "/tmp/pagination",
            model: "test/model",
            status: "completed",
            createdAt: new Date(START).toISOString(),
            updatedAt: new Date(START + firstTurn * 1000).toISOString(),
            messages: data.messages.slice(row.messageStart),
            events: data.events.slice(row.eventStart),
            changes: [],
            pendingSteering: [],
            transcript: {
              messageOffset: row.messageStart,
              eventOffset: row.eventStart,
              messageEnd: totalMessages,
              eventEnd: totalEvents,
              totalMessages,
              firstTurn,
              hasMore: firstTurn > 1,
            },
          };
        }

        function shortSnapshot(prefix, firstTurn) {
          const snapshot = makeSnapshot(prefix, firstTurn);
          const messages = snapshot.messages.slice();
          const last = messages.length - 1;
          messages[last] = {
            ...messages[last],
            content: prefix + " short answer " + firstTurn,
          };
          return { ...snapshot, messages };
        }

        window.makeSnapshot = makeSnapshot;
        window.makeShortSnapshot = shortSnapshot;
        window.calls = [];
        window.delay = 120;
        window.failNextLoad = false;
        window.controller = {
          state: {
            activeSessionId: A,
            activeSnapshot: makeSnapshot("A", 6),
            isSnapshotLoading: false,
            isHistoryLoading: false,
            historyError: null,
            activeRuns: {},
          },
          loadOlderMessages: () => window.loadOlder(),
          answerApproval: () => Promise.resolve(),
          openNewSession: () => {},
        };

        window.loadOlder = async function () {
          const controller = window.controller;
          const sessionId = controller.state.activeSessionId;
          const snapshot = controller.state.activeSnapshot;
          window.calls.push({
            sessionId,
            firstTurn: snapshot.transcript.firstTurn,
          });
          controller.state = {
            ...controller.state,
            isHistoryLoading: true,
            historyError: null,
          };
          window.render();
          await new Promise((resolve) => setTimeout(resolve, window.delay));
          // A stale page response never touches the newly selected session.
          if (controller.state.activeSessionId !== sessionId) return;
          if (window.failNextLoad) {
            window.failNextLoad = false;
            controller.state = {
              ...controller.state,
              isHistoryLoading: false,
              historyError: "模拟历史读取失败",
            };
            window.render();
            return;
          }
          const nextTurn = Math.max(1, snapshot.transcript.firstTurn - 1);
          controller.state = {
            ...controller.state,
            activeSnapshot: makeSnapshot(sessionId === A ? "A" : "B", nextTurn),
            isHistoryLoading: false,
            historyError: null,
          };
          window.render();
        };

        window.switchTo = function (prefix) {
          window.controller.state = {
            ...window.controller.state,
            activeSessionId: prefix === "A" ? A : B,
            activeSnapshot: makeSnapshot(prefix, 6),
            isSnapshotLoading: false,
            isHistoryLoading: false,
            historyError: null,
          };
          window.render();
        };

        window.setShort = function (prefix, firstTurn) {
          window.controller.state = {
            ...window.controller.state,
            activeSessionId: prefix === "A" ? A : B,
            activeSnapshot: shortSnapshot(prefix, firstTurn),
            isSnapshotLoading: false,
            isHistoryLoading: false,
            historyError: null,
          };
          window.render();
        };

        function Harness() {
          const [, force] = useState(0);
          window.render = () => force((value) => value + 1);
          return (
            <div className="wb-app">
              <main className="workbench-main">
                <Transcript />
              </main>
            </div>
          );
        }

        const root = createRoot(document.getElementById("root"));
        root.render(<Harness />);
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "transcript-pagination.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "transcript-state",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            loader: "js",
            contents: `export const useWorkbench = () => window.controller;`,
          }));
        },
      },
    ],
  });

  const js = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
  if (!js || !css) throw new Error("Missing test bundle");

  const browser = await chromium.launch({ headless: true });
  const pageErrors: string[][] = [];
  try {
    // 1. A short recent turn is visible at rest. Its top control must not load
    // by being visible, and the explicit button loads exactly one older turn.
    {
      const { page, errors } = await openPage(browser, js, css);
      pageErrors.push(errors);
      await page.evaluate(() => {
        const w = window as unknown as FakeWindow;
        w.setShort("A", 6);
      });
      await page.getByText("A question 6").waitFor();
      await page.waitForTimeout(400);
      expect(await calls(page)).toBe(0);
      const shortMetrics = await page
        .locator(".workbench-conversation-scroll")
        .evaluate((element) => ({
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }));
      expect(shortMetrics.scrollHeight).toBeLessThanOrEqual(
        shortMetrics.clientHeight + 1,
      );
      expect(shortMetrics.scrollTop).toBe(0);
      const control = page.locator(".transcript-history");
      expect(await control.innerText()).toContain("上滑加载更早对话");
      await control
        .getByRole("button", { name: "加载更早的对话记录" })
        .click();
      await expect.poll(() => calls(page)).toBe(1);
      await page.getByText("A question 5").waitFor();
      expect(await calls(page)).toBe(1);
      // Simulate the server reporting that the oldest loaded turn is the first
      // one; the control switches to its terminal state without another fetch.
      await page.evaluate(() => {
        const w = window as unknown as FakeWindow;
        const snapshot = w.controller.state.activeSnapshot as {
          readonly transcript: Record<string, unknown>;
        };
        w.controller.state = {
          ...w.controller.state,
          activeSnapshot: {
            ...(w.controller.state.activeSnapshot as object),
            transcript: { ...snapshot.transcript, hasMore: false },
          },
        };
        w.render();
      });
      expect(await control.innerText()).toContain("已加载全部记录");
      await page.close();
    }

    // 1b. A transcript shorter than a phone viewport never scrolls, so a real
    // upward wheel must still request exactly one page.
    {
      const { page, errors } = await openPage(browser, js, css);
      pageErrors.push(errors);
      await page.setViewportSize({ width: 390, height: 800 });
      await page.evaluate(() => {
        const w = window as unknown as FakeWindow;
        w.setShort("A", 6);
      });
      await page.getByText("A question 6").waitFor();
      const scroll = page.locator(".workbench-conversation-scroll");
      const box = await scroll.boundingBox();
      if (!box) throw new Error("missing transcript viewport");
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + Math.min(box.height / 2, 120),
      );
      await page.mouse.wheel(0, -140);
      await expect.poll(() => calls(page)).toBe(1);
      await page.getByText("A question 5").waitFor();
      await page.waitForTimeout(300);
      expect(await calls(page)).toBe(1);
      await page.close();
    }

    // 2. A long recent turn scrolls at the tail on entry. A real upward scroll
    // asks for one page only; the prepend keeps the existing turn pinned while
    // a second upward gesture during the request does not start another page.
    {
      const { page, errors } = await openPage(browser, js, css);
      pageErrors.push(errors);
      await page.getByText("A question 6").waitFor();
      const scroll = page.locator(".workbench-conversation-scroll");
      const longMetrics = await scroll.evaluate((element) => ({
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }));
      expect(longMetrics.scrollTop).toBeGreaterThan(200);
      expect(longMetrics.scrollHeight).toBeGreaterThan(
        longMetrics.clientHeight + 200,
      );
      // The window starts at turn 6, so the completed execution record must be
      // paired by its final reply id/recorded turn, never by `turnNumber - 1`.
      const turnSix = page.locator('[data-turn="6"]');
      expect(await turnSix.count()).toBe(1);
      const turnSixSummary = turnSix.locator(".transcript-execution-summary");
      expect(await turnSixSummary.count()).toBe(1);
      expect(await turnSixSummary.innerText()).toContain("总耗时");
      expect(await page.locator('[data-turn="1"]').count()).toBe(0);

      await page.evaluate(() => { (window as unknown as FakeWindow).delay = 500; });
      const box = await scroll.boundingBox();
      if (!box) throw new Error("missing transcript viewport");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
      const anchorBefore = await turnSix.boundingBox();
      expect(anchorBefore).not.toBeNull();
      // A second upward gesture while the page is still in flight is deduped.
      await page.mouse.wheel(0, -140);
      await expect.poll(() => calls(page)).toBe(1);
      await page.getByText("A question 5").waitFor();
      await page.waitForTimeout(300);
      expect(await calls(page)).toBe(1);
      const anchorAfter = await page.locator('[data-turn="6"]').boundingBox();
      expect(anchorAfter).not.toBeNull();
      expect(Math.abs((anchorAfter?.y ?? 0) - (anchorBefore?.y ?? 0))).toBeLessThanOrEqual(
        2,
      );
      expect(await page.locator('[data-turn="5"]').count()).toBe(1);
      expect(await page.locator('[data-turn="6"]').count()).toBe(1);
      // The prepended turn keeps its own execution summary too.
      expect(
        await page
          .locator('[data-turn="5"] .transcript-execution-summary')
          .count(),
      ).toBe(1);
      // Prepending is not "new output": the catch-up indicator stays hidden.
      expect(await page.locator(".transcript-latest").count()).toBe(0);
      // A reader can move again while a slow history request is pending.
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => calls(page)).toBe(2);
      await page.mouse.wheel(0, 180);
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
      const movedBefore = await page.locator('[data-turn="5"]').boundingBox();
      await page.getByText("A question 4").waitFor();
      await page.waitForTimeout(100);
      const movedAfter = await page.locator('[data-turn="5"]').boundingBox();
      expect(movedBefore).not.toBeNull();
      expect(movedAfter).not.toBeNull();
      expect(Math.abs((movedAfter?.y ?? 0) - (movedBefore?.y ?? 0))).toBeLessThanOrEqual(2);
      expect(await calls(page)).toBe(2);
      await page.close();
    }

    // 3. A failed page leaves the current content in place, does not retry on
    // its own, and the visible retry button starts a fresh page.
    {
      const { page, errors } = await openPage(browser, js, css);
      pageErrors.push(errors);
      await page.evaluate(() => {
        const w = window as unknown as FakeWindow;
        w.setShort("A", 6);
        w.failNextLoad = true;
      });
      await page.getByText("A question 6").waitFor();
      await page.locator(".transcript-history-button").click();
      expect(
        await page.locator(".transcript-history-button.is-error").innerText(),
      ).toContain("加载失败，点击重试");
      expect(await calls(page)).toBe(1);
      await page.waitForTimeout(400);
      expect(await calls(page)).toBe(1);
      await page.getByText("A question 6").waitFor();
      await page.locator(".transcript-history-button.is-error").click();
      await expect.poll(() => calls(page)).toBe(2);
      await page.getByText("A question 5").waitFor();
      expect(await page.locator(".transcript-history").innerText()).toContain(
        "上滑加载更早对话",
      );
      await page.close();
    }

    // 4. A pending page and its anchor from session A cannot move or error
    // session B; B starts at its own recent tail and loads its own page.
    {
      const { page, errors } = await openPage(browser, js, css);
      pageErrors.push(errors);
      await page.getByText("A question 6").waitFor();
      const scroll = page.locator(".workbench-conversation-scroll");
      await scroll.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect.poll(() => calls(page)).toBe(1);
      await page.evaluate(() => {
        (window as unknown as FakeWindow).switchTo("B");
      });
      await page.getByText("B question 6").waitFor();
      expect(await page.locator(".transcript-history").innerText()).toContain(
        "上滑加载更早对话",
      );
      await page.waitForTimeout(300);
      expect(await page.locator("text=A question 6").count()).toBe(0);
      await expect
        .poll(() =>
          page.locator(".workbench-conversation-scroll").evaluate((element) =>
            Math.abs(
              element.scrollHeight - element.clientHeight - element.scrollTop,
            ),
          ),
        )
        .toBeLessThanOrEqual(2);
      const logAfterSwitch = await callLog(page);
      expect(logAfterSwitch).toHaveLength(1);
      expect(logAfterSwitch[0]?.sessionId).toBe(SESSION_A);

      await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>(
          ".transcript-history-button",
        );
        if (!button) throw new Error("missing B history button");
        button.click();
      });
      await expect.poll(() => calls(page)).toBe(2);
      await page.getByText("B question 5").waitFor();
      const log = await callLog(page);
      expect(log[1]?.sessionId).toBe(SESSION_B);
      expect(await page.locator("text=A question 6").count()).toBe(0);
      expect(await page.locator("text=B question 5").count()).toBe(1);
      await page.close();
    }

    expect(pageErrors.flat()).toEqual([]);
  } finally {
    await browser.close();
  }
}, 40000);
