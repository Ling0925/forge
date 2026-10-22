import { mkdir, rm } from "node:fs/promises";
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
// Share the production bootstrap with the CLI-only build.
await import("./build-core.mjs");
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
