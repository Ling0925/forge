import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { linkCore, root, run } from "./modules.mjs";

run("core", process.execPath, ["scripts/build.mjs"]);
await linkCore("cli");
run("cli", process.execPath, ["scripts/build-core.mjs"]);

// Preserve the installed launcher path without copying another implementation.
await mkdir(join(root, "dist"), { recursive: true });
const temporary = join(root, `dist/cli-${process.pid}.tmp`);
await writeFile(temporary, '#!/usr/bin/env node\nawait import("../repos/forge-cli/dist/cli.mjs");\n', { mode: 0o755 });
await rename(temporary, join(root, "dist/cli.mjs"));
console.log("Forge CLI ready: dist/cli.mjs -> repos/forge-cli/dist/cli.mjs");
