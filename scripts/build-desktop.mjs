import { linkCore, run } from "./modules.mjs";

// Desktop is an explicit opt-in build; this never changes the CLI launcher.
run("core", process.execPath, ["scripts/build.mjs"]);
await linkCore("web");
run("web", "pnpm", ["--config.verify-deps-before-run=false", "run", "build"]);
await linkCore("desktop");
run("desktop", process.execPath, ["scripts/build.mjs"]);
