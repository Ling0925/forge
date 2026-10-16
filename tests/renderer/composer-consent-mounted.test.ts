import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// Mounted browser run: consent is a DOM click on the explicit button.
// Server markup cannot prove that a later submit/Ctrl+Enter stayed blocked.
const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;
const sessionA = "11111111-1111-4111-8111-111111111111";
const sessionB = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

it("mounted consent is explicit, single-use and revoked by task changes; picker Escape respects the dialog boundary", async () => {
  const bundle = await build({
    stdin: {
      contents: `
      import React, {useReducer, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {defaultPublicSettings} from './src/shared/schemas';
      import {initialWorkbenchState, workbenchReducer} from './src/renderer/state/workbench-reducer';
      import {Composer} from './src/renderer/components/workbench/Composer';
      window.forge = {chooseWorkspace: async () => '/tmp/workspace'};
      const sessionA = ${JSON.stringify(sessionA)};
      const sessionB = ${JSON.stringify(sessionB)};
      const runId = ${JSON.stringify(runId)};
      const snapshot = (id) => ({
        version: 1,
        id,
        title: 'task',
        workspace: '/tmp/workspace',
        model: 'provider/model',
        status: 'idle',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [],
        events: [],
        changes: [],
      });
      function Harness() {
        const [state, dispatch] = useReducer(workbenchReducer, {
          ...initialWorkbenchState,
          settings: {...defaultPublicSettings, model: 'provider/model', isConfigured: true},
          activeSessionId: sessionA,
          activeSnapshot: snapshot(sessionA),
        });
        const [showNew, setShowNew] = useState(false);
        const [configured, setConfigured] = useState(true);
        const creates = (window.createSessionCalls ??= []);
        const calls = (window.startRunCalls ??= []);
        window.testController = {
          state: {...state, settings: {...state.settings, isConfigured: configured}, isNewSessionOpen: showNew},
          setConfigured,
          startRun: async (prompt, permission, model, id, mode) => {
            calls.push({ prompt, permission, model, id, mode });
            dispatch({ type: 'START_RUN_RESOLVED', runHandle: { runId, sessionId: id } });
            dispatch({
              type: 'RUN_EVENT_RECEIVED',
              event: { runId, event: { type: 'run_started', sessionId: id } },
            });
            return true;
          },
          createSession: async (input) => { creates.push(input); return snapshot(sessionA); },
          chooseWorkspace: async () => null,
          cancelRun: async () => {},
          openNewSession: setShowNew,
          selectSession: (sessionId) => {
            setShowNew(false);
            dispatch({ type: 'SELECT_SESSION', sessionId });
            dispatch({ type: 'SET_ACTIVE_SNAPSHOT', snapshot: snapshot(sessionId) });
          },
          clearRun: (sessionId) => dispatch({ type: 'START_RUN_FAILED', sessionId }),
        };
        return <><Composer isNew={showNew} /><button onClick={() => setShowNew(true)}>New task</button></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
      resolveDir: resolve("."),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "empty" },
    plugins: [
      {
        name: "test-controller",
        setup(api) {
          api.onLoad({ filter: /workbench-context\.tsx$/ }, () => ({
            contents:
              "export function useWorkbench() { return window.testController; }",
            loader: "js",
          }));
        },
      },
    ],
  });

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        warnings.push(message.text());
    });
    page.on("pageerror", (error) => warnings.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]?.text ?? "" });

    const prompt = page.locator(`#prompt-${sessionA}`);
    const permission = page.locator("#run-permission");
    const confirm = page.getByRole("button", { name: "我已理解并确认无限制" });
    const calls = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              startRunCalls: { permission: string; prompt: string }[];
            }
          ).startRunCalls.length,
      );
    const confirmShown = () => confirm.isVisible();
    const submitForm = () =>
      page.locator("form.workbench-composer").evaluate((form) => {
        (form as HTMLFormElement).requestSubmit();
      });
    const selectSession = (id: string) =>
      page.evaluate((sessionId) => {
        (
          window as unknown as {
            testController: { selectSession: (id: string) => void };
          }
        ).testController.selectSession(sessionId);
      }, id);
    const blocked = async (expected: number) => {
      await submitForm();
      await page.locator("textarea.composer-textarea").press("Enter");
      expect(await calls()).toBe(expected);
      expect(await confirmShown()).toBe(true);
    };

    await selectSession(sessionB);
    await page.locator(`#prompt-${sessionB}`).fill("preserved session B draft");
    await selectSession(sessionA);
    await prompt.fill("ship the change");
    await permission.selectOption("unrestricted");
    await page.locator("form.workbench-composer").evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    await expect.poll(confirmShown).toBe(true);
    expect(
      await page.getByRole("alert").evaluate((node) => node.textContent),
    ).toContain("无限制权限需要先确认");
    expect(await calls()).toBe(0);

    await prompt.press("Enter");
    await page.locator("form.workbench-composer").evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    await prompt.press("Enter");
    expect(await calls()).toBe(0);
    expect(await confirmShown()).toBe(true);

    // Each revocation starts with real, unconsumed explicit consent.
    await confirm.click();
    await expect.poll(confirmShown).toBe(false);
    await permission.selectOption("workspace");
    await permission.selectOption("unrestricted");
    await blocked(0);

    await confirm.click();
    await expect.poll(confirmShown).toBe(false);
    await selectSession(sessionB);
    const otherPrompt = page.locator(`#prompt-${sessionB}`);
    expect(await otherPrompt.inputValue()).toBe("preserved session B draft");
    await selectSession(sessionA);
    expect(await prompt.inputValue()).toBe("ship the change");
    await blocked(0);

    await confirm.click();
    await expect.poll(confirmShown).toBe(false);
    await prompt.fill("edited task");
    await blocked(0);
    await prompt.fill("ship the change");
    await blocked(0);

    await confirm.click();
    await expect.poll(confirmShown).toBe(false);
    await page.locator("#run-mode").selectOption("plan");
    await page.locator("#run-mode").selectOption("build");
    await blocked(0);

    await confirm.click();
    await expect.poll(confirmShown).toBe(false);
    await page.locator('button[aria-label="运行"]').click();
    await expect.poll(calls).toBe(1);
    const started = await page.evaluate(
      () =>
        (
          window as unknown as {
            startRunCalls: { permission: string; prompt: string }[];
          }
        ).startRunCalls[0],
    );
    expect(started).toMatchObject({
      permission: "unrestricted",
      prompt: "ship the change",
    });

    await page.evaluate(
      ({ current, next }) => {
        const controller = (
          window as unknown as {
            testController: {
              clearRun: (id: string) => void;
              selectSession: (id: string) => void;
            };
          }
        ).testController;
        controller.clearRun(current);
        controller.selectSession(next);
      },
      { current: sessionA, next: sessionB },
    );
    const nextPrompt = page.locator(`#prompt-${sessionB}`);
    expect(await nextPrompt.inputValue()).toBe("preserved session B draft");
    await selectSession(sessionA);
    await expect.poll(() => prompt.inputValue()).toBe("");
    await selectSession(sessionB);
    await nextPrompt.fill("another task");
    await page.locator("#run-permission").selectOption("unrestricted");
    await nextPrompt.press("Enter");
    expect(await calls()).toBe(1);
    expect(await confirmShown()).toBe(true);

    await page.locator("#run-permission").selectOption("workspace");
    await page.locator("#run-permission").selectOption("unrestricted");
    await nextPrompt.press("Enter");
    await nextPrompt.press("Enter");
    expect(await calls()).toBe(1);
    expect(await confirmShown()).toBe(true);
    await page.locator("#run-mode").selectOption("plan");
    expect(await permission.isDisabled()).toBe(true);
    await nextPrompt.press("Enter");
    await expect.poll(calls).toBe(2);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              startRunCalls: { permission: string; mode: string }[];
            }
          ).startRunCalls[1],
      ),
    ).toMatchObject({ permission: "readonly", mode: "plan" });

    await page.getByRole("button", { name: "New task", exact: true }).click();
    expect(await page.locator("dialog[open]").count()).toBe(0);
    const fresh = page.getByRole("form", { name: "新会话输入" });
    const picker = fresh.locator("details.composer-model-picker");
    const summary = picker.locator("summary");
    await summary.click();
    await expect.poll(() => picker.getAttribute("open")).not.toBeNull();
    await fresh.locator("#run-model").press("Escape");
    expect(await picker.getAttribute("open")).toBeNull();
    expect(await fresh.isVisible()).toBe(true);
    expect(await summary.evaluate((node) => node === document.activeElement)).toBe(true);
    const createButton = fresh.getByRole("button", { name: "发送并开始会话", exact: true });
    const newPrompt = fresh.locator("#new-prompt");
    const creates = () =>
      page.evaluate(
        () =>
          (window as unknown as { createSessionCalls: unknown[] })
            .createSessionCalls.length,
      );
    expect(await createButton.isDisabled()).toBe(true);
    await fresh.evaluate((node) => (node as HTMLFormElement).requestSubmit());
    expect(await fresh.getByRole("alert").isVisible()).toBe(true);
    expect(await creates()).toBe(0);
    expect(await calls()).toBe(2);
    await newPrompt.fill("configured new task");
    await createButton.click();
    await expect.poll(calls).toBe(3);
    expect(await creates()).toBe(1);
    await expect.poll(() => fresh.count()).toBe(0);

    await page.evaluate(() =>
      (
        window as unknown as {
          testController: { setConfigured: (value: boolean) => void };
        }
      ).testController.setConfigured(false),
    );
    await page.getByRole("button", { name: "New task", exact: true }).click();
    expect(await createButton.isDisabled()).toBe(true);
    expect(await fresh.getByText("连接模型后即可开始对话。", { exact: false }).isVisible()).toBe(true);
    await newPrompt.fill("must not create a session");
    await createButton.evaluate((node) => (node as HTMLButtonElement).click());
    await newPrompt.press("Enter");
    await fresh.evaluate((node) => (node as HTMLFormElement).requestSubmit());
    expect(await creates()).toBe(1);
    expect(await calls()).toBe(3);
    await selectSession(sessionB);
    await expect.poll(() => fresh.count()).toBe(0);
    await page.evaluate(
      (id) =>
        (
          window as unknown as {
            testController: { clearRun: (id: string) => void };
          }
        ).testController.clearRun(id),
      sessionB,
    );
    await nextPrompt.fill("must not run unconfigured");
    expect(
      await page
        .getByRole("button", { name: "运行", exact: true })
        .isDisabled(),
    ).toBe(true);
    await nextPrompt.press("Enter");
    await submitForm();
    expect(await creates()).toBe(1);
    expect(await calls()).toBe(3);
    expect(warnings).toEqual([]);
  } finally {
    await browser.close();
  }
});
