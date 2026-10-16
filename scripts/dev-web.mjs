import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
await mkdir(".build", { recursive: true });
await build({
  entryPoints: ["src/web/dev.ts"],
  outfile: ".build/web-dev.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "info",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const child = spawn(process.execPath, [".build/web-dev.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code) => { process.exitCode = code ?? 1; });
