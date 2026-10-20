import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

describe("McpPanel mounted browser integration", () => {
  it("supports remote registration, preserves stdio compatibility, and never persists or echoes secrets", async () => {
    const bundle = await build({
      stdin: {
        resolveDir: resolve("."),
        loader: "tsx",
        contents: `
          import { createRoot } from 'react-dom/client';
          import { McpPanel } from './src/renderer/components/workbench/McpPanel';
          import './src/renderer/styles/global.css';

          window.registered = [];
          window.mockServers = [
            {
              id: 'local-stdio',
              label: 'Local Stdio Tool',
              command: 'python3',
              args: ['-m', 'server'],
              enabled: true,
              requestTimeoutMs: 15000,
              envNameCount: 0,
              hasPrivateEnv: false,
              transport: 'stdio',
            },
            {
              id: 'existing-remote',
              label: 'Cloud Search',
              command: '',
              args: [],
              enabled: false,
              requestTimeoutMs: 15000,
              envNameCount: 0,
              hasPrivateEnv: false,
              transport: 'http',
              url: 'https://cloud.mcp.example/search',
              hasPrivateHeaders: true,
              headerCount: 1,
            },
          ];

          window.forge = {
            listMcpServers: async () => window.mockServers,
            registerMcpServer: async (dto) => {
              window.registered.push(dto);
              const newServer = {
                id: dto.id,
                label: dto.label,
                command: 'command' in dto ? dto.command : '',
                args: 'args' in dto ? dto.args : [],
                enabled: false,
                requestTimeoutMs: 15000,
                envNameCount: 0,
                hasPrivateEnv: false,
                transport: 'transport' in dto ? dto.transport : 'stdio',
                url: 'url' in dto ? dto.url : undefined,
                hasPrivateHeaders: 'headers' in dto && Boolean(dto.headers),
                headerCount: 'headers' in dto && dto.headers ? Object.keys(dto.headers).length : 0,
              };
              window.mockServers = [...window.mockServers, newServer];
              return newServer;
            },
            setMcpEnabled: async (id, enabled) => {
              window.mockServers = window.mockServers.map(s => s.id === id ? { ...s, enabled } : s);
            },
            getMcpHealth: async (id) => ({
              id,
              enabled: true,
              connected: true,
              negotiatedProtocolVersion: '2024-11-05',
              lastError: null,
            }),
            removeMcpServer: async (id) => {
              window.mockServers = window.mockServers.filter(s => s.id !== id);
            },
          };

          const root = createRoot(document.getElementById('root')!);
          root.render(<McpPanel />);
        `,
      },
      bundle: true,
      write: false,
      format: "iife",
      outfile: "mcp.js",
      jsx: "automatic",
      loader: { ".woff2": "dataurl" },
      define: { "process.env.NODE_ENV": '"development"' },
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(4000);
      const js = bundle.outputFiles.find((f) => f.path.endsWith(".js"))?.text;
      const css = bundle.outputFiles.find((f) => f.path.endsWith(".css"))?.text;
      if (!js || !css) throw new Error("Missing test bundle files");

      await page.route("http://mcp.test/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<!DOCTYPE html><html><head><style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`,
        }),
      );
      await page.goto("http://mcp.test/");

      // 1. Initial list verification:
      // Local stdio server displays its command array JSON
      await page.getByText("Local Stdio Tool · stdio · 已启用").waitFor();
      expect(await page.getByText('["python3","-m","server"]').isVisible()).toBe(true);

      // Existing remote server displays remote URL and header tag, NOT empty command JSON
      await page.getByText("Cloud Search · HTTP · 已禁用").waitFor();
      expect(await page.getByText("https://cloud.mcp.example/search").isVisible()).toBe(true);
      expect(await page.getByText("已配置私密认证凭据（共 1 项）").isVisible()).toBe(true);

      // 2. Open register dialog
      await page.getByRole("button", { name: "注册服务器" }).click();
      await page.getByRole("heading", { name: "注册 MCP 服务器" }).waitFor();

      // Default transport is stdio: command and args inputs are present, URL input is NOT
      expect(await page.locator("#mcp-server-transport").inputValue()).toBe("stdio");
      expect(await page.locator("#mcp-server-command").isVisible()).toBe(true);
      expect(await page.locator("#mcp-server-args").isVisible()).toBe(true);
      expect(await page.locator("#mcp-server-url").count()).toBe(0);

      // 3. Switch to Streamable HTTP
      await page.locator("#mcp-server-transport").selectOption("http");
      expect(await page.locator("#mcp-server-command").count()).toBe(0);
      expect(await page.locator("#mcp-server-args").count()).toBe(0);
      expect(await page.locator("#mcp-server-url").isVisible()).toBe(true);
      expect(await page.locator("#mcp-server-auth").isVisible()).toBe(true);

      // Fill out remote server form with private Authorization token
      await page.locator("#mcp-server-id").fill("weather-api");
      await page.locator("#mcp-server-name").fill("Weather Service");
      await page.locator("#mcp-server-url").fill("https://weather.example.com/mcp");
      const secretToken = "Bearer ultra-secret-jwt-token-999";
      await page.locator("#mcp-server-auth").fill(secretToken);

      // Submit registration
      await page.getByRole("button", { name: "注册（默认禁用）" }).click();

      // Wait for dialog to close and new server to appear in list
      await page.getByText("Weather Service · HTTP · 已禁用").waitFor();
      expect(await page.getByText("https://weather.example.com/mcp").isVisible()).toBe(true);

      // Verify the DTO sent to bridge.registerMcpServer
      const registered = await page.evaluate(() => Reflect.get(window, "registered"));
      expect(registered).toHaveLength(1);
      expect(registered[0]).toEqual({
        id: "weather-api",
        label: "Weather Service",
        transport: "http",
        url: "https://weather.example.com/mcp",
        headers: { Authorization: secretToken },
        enabled: false,
      });

      // Verify secret is NOT leaked into the DOM text or attributes
      const bodyHtml = await page.content();
      expect(bodyHtml).not.toContain(secretToken);

      // Verify secret is NOT stored in localStorage
      const storageKeys = await page.evaluate(() => Object.keys(localStorage));
      for (const key of storageKeys) {
        const val = await page.evaluate((k) => localStorage.getItem(k), key);
        expect(val).not.toContain(secretToken);
      }

      // Re-open registration dialog and ensure secret draft is cleared
      await page.getByRole("button", { name: "注册服务器" }).click();
      await page.locator("#mcp-server-transport").selectOption("http");
      expect(await page.locator("#mcp-server-auth").inputValue()).toBe("");
      expect(await page.locator("#mcp-server-url").inputValue()).toBe("");

      // 4. Test stdio registration preserves legacy shape without transport/url/headers
      await page.locator("#mcp-server-transport").selectOption("stdio");
      await page.locator("#mcp-server-id").fill("custom-stdio");
      await page.locator("#mcp-server-name").fill("Custom Stdio");
      await page.locator("#mcp-server-command").fill("deno");
      await page.locator("#mcp-server-args").fill('["run", "main.ts"]');
      await page.getByRole("button", { name: "注册（默认禁用）" }).click();

      await page.getByText("Custom Stdio · stdio · 已禁用").waitFor();
      expect(await page.getByText('["deno","run","main.ts"]').isVisible()).toBe(true);

      const registeredStdio = await page.evaluate(() => Reflect.get(window, "registered"));
      expect(registeredStdio).toHaveLength(2);
      expect(registeredStdio[1]).toEqual({
        id: "custom-stdio",
        label: "Custom Stdio",
        command: "deno",
        args: ["run", "main.ts"],
        enabled: false,
      });
      expect("transport" in registeredStdio[1]).toBe(false);
      expect("url" in registeredStdio[1]).toBe(false);
      expect("headers" in registeredStdio[1]).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
