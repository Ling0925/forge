import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("new conversation is inline, preserves drafts and retries in the same session before acceptance", async () => {
  const bundle = await build({
    stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {App} from './src/renderer/components/workbench/App';
      import {defaultPublicSettings} from './src/shared/schemas';
      const oldId = '11111111-1111-4111-8111-111111111111';
      const newId = '22222222-2222-4222-8222-222222222222';
      const runId = '33333333-3333-4333-8333-333333333333';
      const snapshot = (id,title) => ({version:1,id,title,workspace:'/tmp/project',model:'fixture/model',status:'idle',createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',messages:[],events:[],changes:[]});
      const sessions = [snapshot(oldId,'Existing conversation')];
      const listeners = new Set();
      window.counts = {create:0,start:0};
      window.forge = {
        getSettings: async () => ({...defaultPublicSettings,model:'fixture/model',isConfigured:true}),
        listSessions: async () => [...sessions],
        getSession: async (id) => sessions.find(s=>s.id===id),
        onEvent: (listener) => {listeners.add(listener);return ()=>listeners.delete(listener)},
        chooseWorkspace: async () => '/tmp/project',
        listMcpServers: async () => [], listCheckpoints: async () => [],
        getProjectContext: async () => ({instructionSources:[],skills:[],warnings:[],counts:{instructions:0,skills:0,warnings:0}}),
        getDiagnostics: async () => ({transcriptChars:0,projectedChars:0,messageCount:0,summaryFallback:false}),
        createSession: async () => {window.counts.create++;const s=snapshot(newId,'New conversation');sessions.unshift(s);return s},
        startRun: async () => {window.counts.start++;if(window.counts.start===1)throw Error('fixture start failure');
          setTimeout(()=>listeners.forEach(l=>l({runId,event:{type:'run_started',sessionId:newId,model:'fixture/model',permission:'workspace',timestamp:new Date().toISOString()}})),20);
          return {runId,sessionId:newId};},
      };
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"development"' },
  });
  const browser = await chromium.launch({ headless: true, ...(process.env.FORGE_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGE_BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const warnings: string[] = [];
    page.on("pageerror", (error) => warnings.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") warnings.push(message.text()); });
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const fresh = page.getByRole("textbox", { name: "新会话消息" });
    await page.waitForTimeout(100);
    expect(warnings).toEqual([]);
    await fresh.waitFor();
    expect(await page.locator("dialog[open]").count()).toBe(0);
    await fresh.fill("new draft");
    await page.locator(".session-item-main").filter({ hasText: "Existing conversation" }).click();
    const existing = page.getByRole("textbox", { name: "继续任务" });
    await existing.fill("existing draft");
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    expect(await fresh.inputValue()).toBe("new draft");
    expect(await fresh.evaluate((node) => node === document.activeElement)).toBe(true);
    await page.locator(".session-item-main").filter({ hasText: "Existing conversation" }).click();
    expect(await existing.inputValue()).toBe("existing draft");
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page.getByRole("button", { name: "发送并开始会话" }).click();
    await page.getByText("未能开始对话，草稿已保留。请检查错误详情后重试。", { exact: true }).waitFor();
    expect(await fresh.inputValue()).toBe("new draft");
    expect(await page.evaluate(() => (window as unknown as { counts: { create: number } }).counts.create)).toBe(1);
    await page.getByRole("button", { name: "发送并开始会话" }).click();
    await page.getByRole("heading", { name: "New conversation", exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { counts: { create: number; start: number } }).counts)).toEqual({ create: 1, start: 2 });
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    expect(await fresh.inputValue()).toBe("");
    expect(await page.locator("dialog[open]").count()).toBe(0);
    expect(warnings).toEqual([]);
  } finally { await browser.close(); }
}, 20000);
