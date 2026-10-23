import { linkCore, run } from "./modules.mjs";

await linkCore("web");
run("web", "pnpm", ["--config.verify-deps-before-run=false", "run", "build"]);
