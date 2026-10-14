#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
// Public documentation and examples are deliberately bounded to these directories.
// Reject unexpected entries instead of silently omitting an unsafe or broken link.
const assetDirectories = {
  docs: { extensions: [".md"], children: [] },
  "examples/mcp": { extensions: [".mjs", ".md"], children: [] },
  "examples/skills": { extensions: [], children: ["test-driven-repair"] },
  "examples/skills/test-driven-repair": { extensions: [".md"], children: [] },
};
const assetRoots = ["docs", "examples/mcp", "examples/skills"];
async function copyPublicAssets(target) {
  for (const base of assetRoots) {
    async function copyDirectory(name) {
      const rules = assetDirectories[name];
      if (!rules) throw new Error(`Unallowlisted asset directory: ${name}`);
      await mkdir(join(target, name), { recursive: true });
      const entries = (
        await readdir(join(root, name), { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name, "en"));
      for (const entry of entries) {
        const child = `${name}/${entry.name}`;
        if (entry.isDirectory() && rules.children.includes(entry.name)) {
          await copyDirectory(child);
        } else if (
          entry.isFile() &&
          !entry.name.startsWith(".") &&
          rules.extensions.some((ext) => entry.name.endsWith(ext))
        ) {
          await cp(join(root, child), join(target, child));
        } else {
          throw new Error(
            `Unallowlisted public asset (including symlinks): ${child}`,
          );
        }
      }
    }
    await copyDirectory(base);
  }
  const readme = join(root, "README.md");
  if (!(await lstat(readme)).isFile())
    throw new Error("README must be a regular file.");
  await cp(readme, join(target, "README.md"));
}

const root = fileURLToPath(new URL("../", import.meta.url));
const help =
  "Usage: node scripts/release.mjs --help | --dry-run | --build\n--dry-run inspects configuration/dependency resolution only; no build, package or install.\n--build runs the existing build then electron-builder --linux --dir, creates release/<build-id>/, archives and SHA256 checksums. Do not run during concurrent source writes.\n";
const arg = process.argv[2];
if (
  process.argv.length !== 3 ||
  !["--help", "--dry-run", "--build"].includes(arg)
) {
  process.stderr.write(help);
  process.exit(2);
}
if (arg === "--help") {
  process.stdout.write(help);
  process.exit(0);
}
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("This release target requires Linux x64.");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const exe = pkg.build?.linux?.executableName;
if (
  !/^[a-zA-Z][a-zA-Z0-9-]+$/.test(exe ?? "") ||
  pkg.build?.linux?.target?.join(",") !== "dir"
)
  throw new Error("Explicit Linux dir/executableName configuration required.");
if (
  process.versions.node !== "22.23.1" &&
  Number(process.versions.node.split(".")[0]) !== 22
)
  throw new Error("Node 22 required.");
const require = createRequire(join(root, "package.json"));
const pw = require.resolve("playwright/package.json");
const pwRequire = createRequire(pw);
const core = pwRequire.resolve("playwright-core/package.json");
const pwMeta = JSON.parse(await readFile(pw, "utf8"));
const coreMeta = JSON.parse(await readFile(core, "utf8"));
if (
  pwMeta.dependencies?.["playwright-core"] !== coreMeta.version ||
  Object.keys(coreMeta.dependencies ?? {}).length
)
  throw new Error("Unreviewed Playwright dependency graph.");
const packages = { playwright: dirname(pw), "playwright-core": dirname(core) };
for (const [name, path] of Object.entries(packages))
  if (!(await stat(path)).isDirectory()) throw new Error(`Missing ${name}.`);
process.stdout.write(
  `Desktop executable from package.json build.linux.executableName: ${exe}\nCLI external dependencies: ${Object.keys(packages).join(", ")} (${pwMeta.version})\n`,
);
if (arg === "--dry-run") {
  process.stdout.write("Dry run: no files written, no build invoked.\n");
  process.exit(0);
}
const run = (command, args, cwd = root) =>
  new Promise((ok, fail) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error(`${command} failed (${code}).`)),
    );
  });
const release = join(root, "release");
await mkdir(release, { recursive: true });
const buildId = `${pkg.version}-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
const stage = await mkdtemp(join(release, ".staging-"));
const result = join(release, buildId);
async function payloadInventory(base) {
  const entries = [];
  async function digest(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
  }
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const name = relative(base, path).split(sep).join("/");
      const metadata = await lstat(path);
      if (metadata.isDirectory()) {
        entries.push({ path: name, type: "directory" });
        await walk(path);
      } else if (metadata.isFile()) {
        entries.push({
          path: name,
          type: "file",
          bytes: metadata.size,
          sha256: await digest(path),
        });
      } else throw new Error(`Symlink or unsupported artifact entry: ${name}`);
    }
  }
  for (const name of ["cli", "desktop"]) await walk(join(base, name));
  entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { schema: 1, entries };
}
try {
  await run(process.execPath, ["scripts/build.mjs"]);
  await run(join(root, "node_modules/.bin/electron-builder"), [
    "--linux",
    "--dir",
    `--config.directories.output=${join(stage, "builder")}`,
  ]);
  const desktop = join(stage, "builder", "linux-unpacked");
  if (!(await stat(join(desktop, exe))).isFile())
    throw new Error(`Missing built desktop executable: ${exe}`);
  if (!(await stat(join(desktop, "resources", "app.asar"))).isFile())
    throw new Error("Missing desktop app.asar.");
  await cp(desktop, join(stage, "desktop"), {
    recursive: true,
    dereference: true,
  });
  await rm(join(stage, "builder"), { recursive: true });
  await copyPublicAssets(join(stage, "desktop"));
  const cli = join(stage, "cli");
  await mkdir(join(cli, "node_modules"), { recursive: true });
  await cp(join(root, "dist", "cli.mjs"), join(cli, "cli.mjs"));
  for (const [name, path] of Object.entries(packages))
    await cp(path, join(cli, "node_modules", name), {
      recursive: true,
      dereference: true,
    });
  await copyPublicAssets(cli);
  await writeFile(
    join(stage, "cli", "NOTICE.txt"),
    `Forge ${pkg.version}; built ${new Date().toISOString()}\nNode >=22.23.1 <23 required.\nPlaywright ${pwMeta.version} and playwright-core ${coreMeta.version}: see bundled package LICENSE / NOTICE files.\nBundled JavaScript retains esbuild legal comments. Other runtime licenses are included with desktop resources.\nDocumentation contains links to third-party Markdown references; linked sites and their content are not bundled or runtime dependencies. See docs/REFERENCE_DESIGN.md for attribution and original design boundaries.\n`,
  );
  await writeFile(
    join(stage, "desktop", "NOTICE.txt"),
    `Forge ${pkg.version}; built ${new Date().toISOString()}\nDocumentation contains links to third-party Markdown references; linked sites and their content are not bundled or runtime dependencies. See docs/REFERENCE_DESIGN.md for attribution.\nElectron and runtime dependency notices are included with desktop resources; inspect them before distribution.\n`,
  );
  // Invoke from the stage's parent: provenance intentionally does not inventory audit transcripts.
  await run(process.execPath, [
    "scripts/provenance.mjs",
    "--output",
    join(stage, "SOURCE-SHA256.json"),
  ]);
  const inventory = await payloadInventory(stage);
  await writeFile(
    join(stage, "PAYLOAD-SHA256.json"),
    `${JSON.stringify(inventory)}\n`,
    { flag: "wx" },
  );
  await run(process.execPath, [join(cli, "cli.mjs"), "--help"], tmpdir());
  await run(
    process.execPath,
    [
      "-e",
      "const {createRequire}=require('node:module');const r=createRequire(process.cwd()+'/cli.mjs');if(!r('playwright').chromium||!r('playwright-core').chromium)process.exit(1)",
    ],
    cli,
  );
  await rename(stage, result);
  for (const component of ["cli", "desktop"])
    await run("tar", [
      "-C",
      result,
      "-czf",
      join(result, `${component}.tar.gz`),
      component,
    ]);
  const lines = [];
  for (const name of [
    "cli.tar.gz",
    "desktop.tar.gz",
    "SOURCE-SHA256.json",
    "PAYLOAD-SHA256.json",
  ]) {
    const bytes = await readFile(join(result, name));
    lines.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
  }
  await writeFile(join(result, "SHA256SUMS"), `${lines.join("\n")}\n`, {
    flag: "wx",
  });
  await writeFile(
    join(result, "release.json"),
    `${JSON.stringify(
      {
        schema: 1,
        buildId,
        version: pkg.version,
        builtAt: new Date().toISOString(),
        platform: "linux-x64",
        desktopExecutable: exe,
        cliNode: ">=22.23.1 <23",
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  process.stdout.write(`Release: ${result}\n`);
} catch (error) {
  await rm(stage, { recursive: true, force: true });
  throw error;
}
