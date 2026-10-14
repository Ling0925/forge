import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
// Deliberately use the production file-origin topology in development too.
// Restart this command after edits; there is no privileged remote dev origin.
const build = spawn(process.execPath, ["scripts/build.mjs"], {
  stdio: "inherit",
});
const code = await new Promise((resolve, reject) => {
  build.once("error", reject);
  build.once("exit", (status) => resolve(status ?? 1));
});
if (code !== 0) process.exit(code);
const child = spawn(electron, ["."], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (status) => {
  process.exitCode = status ?? 1;
});
