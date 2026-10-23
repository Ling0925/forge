import { spawnSync } from "node:child_process";
import { lstat, mkdir, readlink, rename, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const modules = {
  core: join(root, "repos/forge-core"),
  cli: join(root, "repos/forge-cli"),
  web: join(root, "repos/forge-web-ui"),
};

export function run(module, program, args) {
  const result = spawnSync(program, args, { cwd: modules[module], stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Use the sibling Core rather than pnpm's file: snapshot during local development.
// CLI builds never replace the running Web process's dependency link.
export async function linkCore(module) {
  const link = join(modules[module], "node_modules/@forge/core");
  const installed = await lstat(link).catch(error => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (installed) {
    if (!installed.isSymbolicLink()) throw new Error(`Expected a dependency symlink: ${link}`);
    if (resolve(dirname(link), await readlink(link)) === modules.core) return;
  }
  await mkdir(dirname(link), { recursive: true });
  const temporary = `${link}.forge-${process.pid}`;
  await symlink(relative(dirname(link), modules.core), temporary);
  await rename(temporary, link);
}
