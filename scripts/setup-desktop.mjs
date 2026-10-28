import { linkCore, run } from "./modules.mjs";

run("core", "pnpm", ["install", "--frozen-lockfile"]);
run("core", process.execPath, ["scripts/build.mjs"]);
for (const module of ["web", "desktop"]) {
  run(module, "pnpm", ["install", "--frozen-lockfile"]);
  await linkCore(module);
}
console.log("Desktop dependencies ready. Run pnpm build:desktop.");
