import { linkCore, run } from "./modules.mjs";

run("core", "pnpm", ["install", "--frozen-lockfile"]);
run("core", process.execPath, ["scripts/build.mjs"]);
for (const module of ["cli", "web"]) {
  run(module, "pnpm", ["install", "--frozen-lockfile"]);
  await linkCore(module);
}
console.log("Dependencies ready. Run node scripts/build-core.mjs to build the CLI.");
