import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("renders floating jump-to-latest button and interactive queue list with cancel, edit, and drag reorder", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve("."),
      loader: "tsx",
      contents: `
        import { createRoot } from "react-dom/client";
        import { Composer } from "./src/renderer/components/workbench/Composer";
        import { Transcript } from "./src/renderer/components/workbench/Transcript";
        import { WorkbenchProvider, useWorkbench } from "./src/renderer/state/workbench-context";
        import { defaultPublicSettings } from "./src/shared/schemas";
        import "./src/renderer/styles/global.css";
        import "./src/renderer/components/workbench/app.css";
        import "./src/renderer/styles/workspace-theme.css";
        import "./src/renderer/styles/settings-models.css";

        const a = "11111111-1111-4111-8111-111111111111";
        const initialMessages = Array.from({ length: 18 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: \`这是第 \${i + 1} 条历史对话内容，用于填充滚动区域高度。\\n第二行文字确保滚动容器存在可滚动距离。\`,
          timestamp: "2026-01-01T00:00:00.000Z",
        }));
        const snapshots = {
          [a]: {
            version: 1,
            id: a,
            title: "A",
            workspace: "/tmp",
            model: "a-model",
            providerSourceId: "a",
            status: "idle",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            messages: initialMessages,
            events: [],
            changes: [],
          },
        };
        const listeners = new Set();
        const live = new Map();
        let counter = 0;
        const emit = (runId, event) => {
          for (const listener of listeners) {
            listener({ runId, event: { timestamp: new Date().toISOString(), ...event } });
          }
        };
        const fixture = (window.fixture = {
          starts: [],
          streamDelta: (text) => {
            const runId = live.get(a) || "33333333-3333-4333-8333-000000000099";
            emit(runId, { type: "assistant_delta", sessionId: a, text });
          },
          finish: (sessionId, status) => {
            const runId = live.get(sessionId);
            live.delete(sessionId);
            snapshots[sessionId].status = status;
            emit(runId, { type: "run_finished", sessionId, status, turns: 1, toolCalls: 0 });
          },
        });
        window.forge = {
          getSettings: async () => ({
            ...defaultPublicSettings,
            isConfigured: true,
            baseUrl: "https://a.invalid/v1",
            model: "a-model",
            activeSourceId: "a",
            providerSources: [
              { id: "a", label: "Source A", baseUrl: "https://a.invalid/v1", model: "a-model", hasApiKey: false },
            ],
          }),
          listSessions: async () => Object.values(snapshots),
          getSession: async (id) => structuredClone(snapshots[id]),
          listModels: async () => ["a-model"],
          onEvent: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          startRun: async (input) => {
            fixture.starts.push(input);
            const runId = "33333333-3333-4333-8333-" + String(++counter).padStart(12, "0");
            const snapshot = snapshots[input.sessionId];
            snapshot.messages.push({
              role: "user",
              content: input.prompt,
              timestamp: new Date().toISOString(),
            });
            snapshot.status = "running";
            live.set(input.sessionId, runId);
            setTimeout(
              () =>
                emit(runId, {
                  type: "run_started",
                  sessionId: input.sessionId,
                  model: snapshot.model,
                  permission: input.permission ?? "workspace",
                }),
              0,
            );
            return { runId, sessionId: input.sessionId };
          },
          steerRun: async () => {},
          cancelRun: async (runId) => {
            const sessionId = [...live].find(([, id]) => id === runId)?.[0];
            if (sessionId) fixture.finish(sessionId, "cancelled");
          },
          chooseWorkspace: async () => null,
          setRunPermission: async (_id, permission) => permission,
        };
        function Harness() {
          const { selectSession } = useWorkbench();
          return (
            <div className="wb-app" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
              <button type="button" onClick={() => selectSession(a)}>打开 A</button>
              <main className="workbench-main" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <Transcript />
                <Composer />
              </main>
            </div>
          );
        }
        createRoot(document.getElementById("root")).render(
          <WorkbenchProvider>
            <Harness />
          </WorkbenchProvider>,
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "queue-latest.js",
    loader: { ".woff2": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"' },
  });

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.FORGE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1024, height: 640 },
    });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://forge.test/**", (route) =>
      route.fulfill({
        body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>',
        contentType: "text/html",
      }),
    );
    await page.goto("http://forge.test");
    const js = bundle.outputFiles.find((file) =>
      file.path.endsWith(".js"),
    )?.text;
    if (!js) throw new Error("Missing mounted bundle");
    const css =
      bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: js });

    await page.getByRole("button", { name: "打开 A", exact: true }).click();
    const scrollContainer = page.locator(".workbench-conversation-scroll");
    await scrollContainer.waitFor();

    // Start a run
    const input = page.locator("textarea.composer-textarea");
    await input.fill("initial task");
    await input.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "fixture").starts.length),
      )
      .toBe(1);
    await page.locator(".composer-activity").waitFor();

    // Measure scroll container height before floating button appears
    const scrollBoxBefore = await scrollContainer.boundingBox();
    if (!scrollBoxBefore) throw new Error("Missing scroll container box");

    // Scroll up so transcript detaches from bottom, then stream new content
    await scrollContainer.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await page.evaluate(() =>
      Reflect.get(window, "fixture").streamDelta("新的流式内容到达"),
    );

    const latestWrapper = page.locator(".transcript-latest");
    const latestBtn = page.getByRole("button", { name: "查看最新消息" });
    await latestBtn.waitFor();

    // Verify floating button does not shrink scroll container and has floating pill styling
    const scrollBoxAfter = await scrollContainer.boundingBox();
    const latestWrapperStyle = await latestWrapper.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { position: s.position, pointerEvents: s.pointerEvents };
    });
    const latestBtnStyle = await latestBtn.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { borderRadius: s.borderRadius, pointerEvents: s.pointerEvents };
    });
    expect(latestWrapperStyle.position).toBe("absolute");
    expect(latestWrapperStyle.pointerEvents).toBe("none");
    expect(latestBtnStyle.pointerEvents).toBe("auto");
    expect(
      Number.parseFloat(latestBtnStyle.borderRadius),
    ).toBeGreaterThanOrEqual(999);
    expect(scrollBoxAfter?.height).toBe(scrollBoxBefore.height);

    const composerBox = await page.locator(".workbench-composer").boundingBox();
    const latestBtnBox = await latestBtn.boundingBox();
    if (!composerBox || !latestBtnBox)
      throw new Error("Missing boxes for floating button check");
    expect(latestBtnBox.y + latestBtnBox.height).toBeLessThanOrEqual(
      composerBox.y + 2,
    );

    // Click floating button to jump to latest
    await latestBtn.click();
    await expect.poll(() => latestBtn.count()).toBe(0);

    // Queue 1 item first and verify compact inline layout without giant background block
    await input.fill("first queued draft");
    await input.press("Enter");
    await expect
      .poll(() => page.locator(".composer-queue-item").count())
      .toBe(1);
    const queueOuterStyle = await page
      .locator(".composer-queue")
      .evaluate((el) => {
        const s = window.getComputedStyle(el);
        return {
          backgroundColor: s.backgroundColor,
          borderTopWidth: s.borderTopWidth,
          flexDirection: s.flexDirection,
        };
      });
    expect(queueOuterStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(queueOuterStyle.borderTopWidth).toBe("0px");
    expect(queueOuterStyle.flexDirection).toBe("row");

    await mkdir(resolve(".build/queue-ui"), { recursive: true });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page
      .locator(".workbench-composer")
      .screenshot({
        path: resolve(".build/queue-ui/queue-1-item-dark.png"),
        animations: "disabled",
      });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page
      .locator(".workbench-composer")
      .screenshot({
        path: resolve(".build/queue-ui/queue-1-item-light.png"),
        animations: "disabled",
      });

    // Queue 2 more items (total 3 items)
    await input.fill("second to cancel");
    await input.press("Enter");
    await input.fill("third to move first");
    await input.press("Enter");

    await expect
      .poll(() => page.locator(".composer-queue-item").count())
      .toBe(3);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page
      .locator(".workbench-composer")
      .screenshot({
        path: resolve(".build/queue-ui/queue-3-items-dark.png"),
        animations: "disabled",
      });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page
      .locator(".workbench-composer")
      .screenshot({
        path: resolve(".build/queue-ui/queue-3-items-light.png"),
        animations: "disabled",
      });
    expect(await page.locator(".composer-queue-title").innerText()).toBe(
      "待发 3 条",
    );
    expect(
      await page
        .locator(".composer-queue-item .composer-queue-text")
        .allInnerTexts(),
    ).toEqual([
      "first queued draft",
      "second to cancel",
      "third to move first",
    ]);

    // 1. Edit first item in place
    await page
      .getByRole("button", { name: "编辑第 1 条待发消息", exact: true })
      .click();
    const editInput = page.locator(".composer-queue-edit-input");
    await editInput.waitFor();
    expect(await editInput.inputValue()).toBe("first queued draft");
    await editInput.fill("first queued edited");
    await editInput.press("Enter");
    expect(
      await page
        .locator(".composer-queue-item .composer-queue-text")
        .allInnerTexts(),
    ).toEqual([
      "first queued edited",
      "second to cancel",
      "third to move first",
    ]);

    // 2. Cancel/remove second item
    await page
      .getByRole("button", { name: "取消第 2 条待发消息", exact: true })
      .click();
    expect(await page.locator(".composer-queue-title").innerText()).toBe(
      "待发 2 条",
    );
    expect(
      await page
        .locator(".composer-queue-item .composer-queue-text")
        .allInnerTexts(),
    ).toEqual(["first queued edited", "third to move first"]);

    // 3. Drag-and-drop reorder: drag item 2 onto item 1
    await page
      .locator(".composer-queue-item")
      .nth(1)
      .dragTo(page.locator(".composer-queue-item").nth(0));
    expect(
      await page
        .locator(".composer-queue-item .composer-queue-text")
        .allInnerTexts(),
    ).toEqual(["third to move first", "first queued edited"]);

    // Finish initial run and verify queued items execute in the new reordered sequence with edited text
    await page.evaluate(() =>
      Reflect.get(window, "fixture").finish(
        "11111111-1111-4111-8111-111111111111",
        "completed",
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "fixture").starts.length),
      )
      .toBe(2);
    await page.evaluate(() =>
      Reflect.get(window, "fixture").finish(
        "11111111-1111-4111-8111-111111111111",
        "completed",
      ),
    );
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "fixture").starts.length),
      )
      .toBe(3);

    const executedPrompts = await page.evaluate(() =>
      Reflect.get(window, "fixture").starts.map(
        (item: { prompt: string }) => item.prompt,
      ),
    );
    expect(executedPrompts).toEqual([
      "initial task",
      "third to move first",
      "first queued edited",
    ]);
    await expect.poll(() => page.locator(".composer-queue").count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
