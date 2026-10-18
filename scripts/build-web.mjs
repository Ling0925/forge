import { chmod, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);

// Only these two outputs are replaced. The CLI (`dist/cli.mjs`) and desktop
// (`dist/desktop/*`) bundles from scripts/build.mjs are left untouched.
await mkdir("dist/web", { recursive: true });
await build({
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["playwright", "playwright-core"],
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info",
  entryPoints: ["src/web/serve.ts"],
  outfile: "dist/web/serve.mjs",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as forgeCreateRequire } from "node:module"; const require = forgeCreateRequire(import.meta.url);',
  },
});
await chmod("dist/web/serve.mjs", 0o755);

// The renderer is shared with the desktop build; Vite owns dist/renderer, so
// running this after a desktop build regenerates only that directory.
await buildRenderer({ configFile: "vite.config.ts" });
