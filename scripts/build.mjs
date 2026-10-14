import { chmod, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
await rm("dist", { recursive: true, force: true });
await mkdir("dist/desktop", { recursive: true });
const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  external: ["electron", "playwright", "playwright-core"],
  sourcemap: false,
  legalComments: "eof",
  logLevel: "info",
};
await build({
  ...common,
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/cli.mjs",
  format: "esm",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as forgeCreateRequire } from "node:module"; const require = forgeCreateRequire(import.meta.url);',
  },
});
await chmod("dist/cli.mjs", 0o755);
for (const name of ["main", "preload", "worker"]) {
  await build({
    ...common,
    entryPoints: [`src/desktop/${name}.ts`],
    outfile: `dist/desktop/${name}.cjs`,
    format: "cjs",
    metafile: name === "preload",
  }).then((result) => {
    if (name !== "preload" || !result.metafile) {
      return;
    }
    for (const path of Object.keys(result.metafile.inputs)) {
      const normalized = path.replaceAll("\\", "/");
      if (
        normalized !== "src/desktop/preload.ts" &&
        !normalized.startsWith("src/shared/") &&
        !normalized.includes("node_modules/zod/")
      ) {
        throw new Error(
          "Preload must only bundle shared contracts and their schema dependency.",
        );
      }
    }
    for (const output of Object.values(result.metafile.outputs)) {
      for (const dependency of output.imports) {
        if (dependency.external && dependency.path !== "electron") {
          throw new Error(
            "Preload must not import external host dependencies.",
          );
        }
      }
    }
  });
}
await buildRenderer({ configFile: "vite.config.ts" });
