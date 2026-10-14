import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

// A real mounted browser run is required: horizontal overflow inside the
// inspector pane is an outcome of the real CSS cascade (a 320px flex column
// pane plus an unbreakable command/path token), which a markup snapshot cannot
// observe.
// Uses the normal Playwright browser by default; set FORGE_BROWSER_EXECUTABLE
// (same override as the browser tool) when the bundled browser is not on disk.
const executablePath = process.env.FORGE_BROWSER_EXECUTABLE;

const sessionId = "wrap-session";
const command =
  "/opt/forge-tools/node-v22.23.1-linux-x64/lib/node_modules/@acme-internal/mcp-servers/dist/bin/very-long-server-entry-point-name.js";
const args = [
  "--transport",
  "stdio",
  "--config",
  "/home/ling/services/desktop-harness/.build/desktop-smoke-workspace/configuration/very-long-configuration-file-name-with-many-segments.json",
  `--registry=${`registry-token-${"z".repeat(200)}`}`,
  "--workspace-root",
  "/home/ling/services/desktop-harness/examples/deep/nested/workspace/directory/tree/that/keeps/going/and/going/further/still",
];
const commandLine = JSON.stringify([command, ...args]);
const instructionPath = `/home/ling/services/desktop-harness/.build/evolution-qa-workspace/agents/instructions/${"u".repeat(180)}AGENTS.md`;
const skillId = `skill-${"i".repeat(150)}`;
const skillDirectory = `/home/ling/services/desktop-harness/skills/${"s".repeat(150)}`;
// Negative control: the same shape of text without the wrap treatment, proving
// the measurement below really detects the pre-repair overflow.
const controlToken = "c".repeat(260);

it("mounted narrow inspector wraps a long MCP command and resource paths without horizontal overflow", async () => {
  // In-memory test-only bundling that also emits the real component CSS; this
  // is not an application build and mutates no assets.
  const bundle = await build({
    stdin: {
      contents: `
      import './src/renderer/styles/global.css';
      import './src/renderer/components/workbench/app.css';
      import {createRoot} from 'react-dom/client';
      import {Inspector} from './src/renderer/components/workbench/Inspector';
      const session = {
        id: ${JSON.stringify(sessionId)},
        title: '长命令资源会话',
        model: 'deepseek-clinepass',
        workspace: '/home/ling/services/desktop-harness',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        messages: [], events: [], changes: [],
      };
      window.forge = {
        listMcpServers: async () => [{
          id: 'acme-long',
          label: '超长命令 MCP 服务器',
          command: ${JSON.stringify(command)},
          args: ${JSON.stringify(args)},
          enabled: true,
          requestTimeoutMs: 5000,
          envNameCount: 0,
          hasPrivateEnv: false,
        }],
        getProjectContext: async () => ({
          workspace: '/home/ling/services/desktop-harness',
          instructionSources: [{path: ${JSON.stringify(instructionPath)}, order: 0, bytes: 4096}],
          skills: [{
            id: ${JSON.stringify(skillId)},
            name: '长路径技能',
            description: '带长来源目录的技能元数据',
            version: '1.0.0',
            sourceDirectory: ${JSON.stringify(skillDirectory)},
            provenance: 'workspace-agents',
          }],
          warnings: [],
          counts: {instructions: 1, skills: 1, warnings: 0},
        }),
        listCheckpoints: async () => [],
        getCheckpointDiff: async () => '',
        restoreCheckpoint: async () => session,
        getDiagnostics: async () => null,
        cancelSession: async () => false,
        compactSession: async () => session,
      };
      window.testController = {
        state: {
          activeSessionId: session.id,
          activeSnapshot: session,
          sessions: [session],
          activeRuns: {},
          settings: {model: 'deepseek-clinepass', defaultPermission: 'workspace'},
          alertError: null,
          mobileTab: 'task',
          isMobileSidebarOpen: false,
        },
        selectSession: () => {}, refreshActiveSession: () => {},
        answerApproval: () => {}, openNewSession: () => {},
        openSettings: () => {}, setMobileTab: () => {},
        setMobileSidebar: () => {}, clearAlert: () => {},
        loadSettings: () => {}, loadSessions: () => {},
      };
      // The real inspector always sits inside the .wb-app workbench shell; the
      // shell is the rendered container whose measured width the assertions
      // below use, so the pane is never pinned to a hardcoded layout number.
      createRoot(document.getElementById('root')).render(
        <div className="wb-app" id="app-shell"><Inspector/></div>,
      );
    `,
      resolveDir: resolve("."),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    outfile: "wrap-bundle.js",
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [
      {
        name: "local-font-faces",
        setup(api) {
          // Keep the real global/tokens CSS, but avoid fetching font assets in
          // the document created by setContent. The token font stacks remain.
          api.onResolve({ filter: /^@fontsource-variable\// }, (args) => ({
            path: args.path,
            namespace: "test-font-face",
          }));
          api.onLoad({ filter: /.*/, namespace: "test-font-face" }, () => ({
            contents: "",
            loader: "css",
          }));
        },
      },
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

  const js =
    bundle.outputFiles.find((file) => file.path.endsWith("wrap-bundle.js"))
      ?.text ?? "";
  const css =
    bundle.outputFiles.find((file) => file.path.endsWith("wrap-bundle.css"))
      ?.text ?? "";
  expect(js).not.toBe("");
  expect(css).toContain("--font-mono");
  expect(css).toContain(".inspector-scroll");

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    // Measured scenarios: the 1440 desktop shell, the 390 narrow reflow from
    // the redesign contract, and narrower container stress that pushes the
    // resources tabpanel well below the named inspector width.
    const scenarios: {
      readonly label: string;
      readonly viewport: { readonly width: number; readonly height: number };
      readonly shellWidth?: number;
      // "named" = the desktop contract applies the --inspector-width token;
      // "container" = the responsive narrow reflow makes the pane fill the
      // rendered shell, which is narrower than the named width.
      readonly expect: "named" | "container";
    }[] = [
      {
        label: "1440 desktop shell",
        viewport: { width: 1440, height: 1000 },
        expect: "named",
      },
      {
        label: "390 narrow viewport",
        viewport: { width: 390, height: 1000 },
        expect: "container",
      },
      {
        label: "300px container stress",
        viewport: { width: 390, height: 1000 },
        shellWidth: 300,
        expect: "container",
      },
      {
        label: "260px container stress",
        viewport: { width: 390, height: 1000 },
        shellWidth: 260,
        expect: "container",
      },
    ];

    const measureScenario = async (scenario: (typeof scenarios)[number]) => {
      const page = await browser.newPage({ viewport: scenario.viewport });
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // The negative-control pane is intentionally unsized here; it is given
      // the real rendered pane width below so it measures the same available
      // space instead of a hardcoded legacy column.
      await page.setContent(
        '<div id="root"></div><div id="control-pane" style="padding:16px;overflow:auto"><div class="wb-stack"><code id="control-code"></code></div></div>',
      );
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: js });
      await page.evaluate((token) => {
        const control = document.getElementById("control-code");
        if (control) control.textContent = token;
      }, controlToken);
      if (scenario.shellWidth !== undefined) {
        await page.evaluate((width) => {
          const shell = document.getElementById("app-shell");
          if (shell instanceof HTMLElement) shell.style.width = `${width}px`;
        }, scenario.shellWidth);
      }

      await page.getByRole("tab", { name: "资源" }).click();
      const resourcesPanel = page.locator("#tabpanel-inspector-resources");
      await resourcesPanel.waitFor({ state: "visible" });
      await page.waitForFunction(
        (expected) =>
          Array.from(
            document.querySelectorAll("#tabpanel-inspector-resources code"),
          ).some((node) => node.textContent === expected),
        commandLine,
      );
      // Skill metadata sits behind a disclosure; open it so the long source
      // directory and id are rendered when measured.
      await resourcesPanel.locator("details > summary").click();

      const report = await page.evaluate(
        ({ expectedCommand, expectedPath, controlText }) => {
          const element = (selector: string): HTMLElement => {
            const found = document.querySelector(selector);
            if (!(found instanceof HTMLElement))
              throw new Error(`missing element: ${selector}`);
            return found;
          };
          const box = (node: HTMLElement) => ({
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
            right: node.getBoundingClientRect().right,
          });
          const metrics = (node: HTMLElement) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return {
              text: node.textContent ?? "",
              right: rect.right,
              height: rect.height,
              fontSize: style.getPropertyValue("font-size"),
              lineHeightPx:
                Number.parseFloat(style.getPropertyValue("line-height")) || 0,
              whiteSpace: style.getPropertyValue("white-space"),
              lineClamp: style.getPropertyValue("-webkit-line-clamp"),
              textOverflow: style.getPropertyValue("text-overflow"),
              userSelect: style.getPropertyValue("user-select"),
            };
          };
          const codes = Array.from(
            document.querySelectorAll("#tabpanel-inspector-resources code"),
          ).filter((node): node is HTMLElement => node instanceof HTMLElement);
          const commandCode = codes.find(
            (node) => node.textContent === expectedCommand,
          );
          const pathCode = codes.find(
            (node) => node.textContent === expectedPath,
          );
          if (!commandCode || !pathCode)
            throw new Error("command/path code nodes are not mounted");
          const directoryNode = Array.from(
            document.querySelectorAll("#tabpanel-inspector-resources p"),
          ).find((node) => node.textContent?.startsWith("workspace-agents ·"));
          if (!(directoryNode instanceof HTMLElement))
            throw new Error("skill source directory node is not mounted");
          const scroll = element(".inspector-scroll");
          // Negative control: give the unwrapped pane the same available width
          // the real pane actually has, so it is not measured against a
          // hardcoded legacy column.
          const controlPane = element("#control-pane");
          controlPane.style.width = `${scroll.clientWidth}px`;
          const controlCode = element("#control-code");
          controlCode.textContent = controlText;
          return {
            viewportWidth: window.innerWidth,
            inspectorWidthToken: Number.parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue(
                "--inspector-width",
              ),
            ),
            documentOverflow:
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            shell: box(element("#app-shell")),
            inspector: {
              ...box(element(".workbench-inspector")),
              computedWidth: Number.parseFloat(
                getComputedStyle(element(".workbench-inspector")).width,
              ),
            },
            inspectorScroll: box(scroll),
            resourcesPanel: box(element("#tabpanel-inspector-resources")),
            command: metrics(commandCode),
            path: metrics(pathCode),
            skillDirectory: metrics(directoryNode),
            controlPane: box(controlPane),
            controlCode: {
              ...metrics(controlCode),
              ...box(controlCode),
            },
          };
        },
        {
          expectedCommand: commandLine,
          expectedPath: instructionPath,
          controlText: controlToken,
        },
      );
      await page.close();
      return { ...report, errors };
    };

    for (const scenario of scenarios) {
      const report = await measureScenario(scenario);

      // The available width is derived, never pinned: the pane must be exactly
      // the named inspector width where the desktop contract applies, and
      // exactly the rendered shell width once the responsive narrow reflow
      // takes over. Either way it must never exceed its own container.
      expect(report.inspectorWidthToken).toBeGreaterThan(0);
      if (scenario.expect === "named") {
        expect(report.inspector.computedWidth).toBe(report.inspectorWidthToken);
      } else {
        expect(report.inspector.computedWidth).toBe(report.shell.clientWidth);
      }
      expect(report.inspector.clientWidth).toBeLessThanOrEqual(
        report.shell.clientWidth,
      );
      // The resources tabpanel is bounded by the actual inspector pane, not by
      // a number copied from the previous layout.
      expect(report.resourcesPanel.clientWidth).toBeLessThan(
        report.inspector.clientWidth,
      );

      // The repair: with the long command mounted, neither the shell, the
      // inspector scroll pane nor the resources tabpanel overflows
      // horizontally at the contracted available width.
      expect(report.documentOverflow).toBeLessThanOrEqual(0);
      expect(report.shell.scrollWidth).toBeLessThanOrEqual(
        report.shell.clientWidth,
      );
      expect(report.inspectorScroll.scrollWidth).toBeLessThanOrEqual(
        report.inspectorScroll.clientWidth,
      );
      expect(report.resourcesPanel.scrollWidth).toBeLessThanOrEqual(
        report.resourcesPanel.clientWidth,
      );

      // Full text is retained, wrapped and selectable: not clipped, hidden,
      // truncated or shrunk.
      expect(report.command.text).toBe(commandLine);
      expect(report.command.whiteSpace).toBe("normal");
      expect(report.command.lineClamp).toMatch(/^(none)?$/);
      expect(report.command.textOverflow).not.toBe("ellipsis");
      expect(report.command.userSelect).not.toBe("none");
      expect(report.command.right).toBeLessThanOrEqual(
        report.resourcesPanel.right + 0.5,
      );
      // Wrapped over several lines at the unsmoothed base code font size.
      expect(report.command.height).toBeGreaterThan(
        report.command.lineHeightPx * 1.5,
      );
      expect(report.command.fontSize).toBe(report.controlCode.fontSize);

      // Same treatment for resource path and skill metadata.
      expect(report.path.text).toBe(instructionPath);
      expect(report.path.right).toBeLessThanOrEqual(
        report.resourcesPanel.right + 0.5,
      );
      expect(report.path.height).toBeGreaterThan(report.path.lineHeightPx);
      expect(report.skillDirectory.text).toContain(skillDirectory);
      expect(report.skillDirectory.right).toBeLessThanOrEqual(
        report.resourcesPanel.right + 0.5,
      );

      // Negative control: the identical shape of text without the wrap
      // treatment still overflows the same derived pane width by a wide margin,
      // so the invariants above are real measurements rather than vacuous ones.
      expect(report.controlCode.text).toBe(controlToken);
      expect(report.controlPane.clientWidth).toBe(
        report.inspectorScroll.clientWidth,
      );
      expect(report.controlPane.scrollWidth).toBeGreaterThan(
        report.controlPane.clientWidth + 100,
      );

      expect(report.errors, scenario.label).toEqual([]);
    }
  } finally {
    await browser.close();
  }
}, 60000);
