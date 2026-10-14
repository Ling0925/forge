#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
const help =
  "Usage: node scripts/install-local.mjs --help | --dry-run RELEASE_DIR | --install RELEASE_DIR | --rollback BUILD_ID\nInstalls only to ~/.local/share/forge-harness/releases, ~/.local/bin/forge{,-desktop}, ~/.local/share/applications/forge.desktop. Retains old releases. No uninstall.\n";
const [mode, operand] = process.argv.slice(2);
if (mode === "--help" && !operand) {
  process.stdout.write(help);
  process.exit(0);
}
if (
  !["--dry-run", "--install", "--rollback"].includes(mode) ||
  !operand ||
  process.argv.length !== 4
) {
  process.stderr.write(help);
  process.exit(2);
}
const home = homedir();
const base = join(home, ".local/share/forge-harness");
const releases = join(base, "releases");
const current = join(base, "current");
const bin = join(home, ".local/bin");
const applications = join(home, ".local/share/applications");
const paths = [
  join(bin, "forge"),
  join(bin, "forge-desktop"),
  join(applications, "forge.desktop"),
];
const exists = async (path) =>
  lstat(path).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
const quote = (path) => `'${path.replaceAll("'", "'\\''")}'`;
const desktopQuote = (path) =>
  `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("`", "\\`").replaceAll("$", "\\$")}"`;
async function validate(directory) {
  const meta = JSON.parse(
    await readFile(join(directory, "release.json"), "utf8"),
  );
  if (
    meta.schema !== 1 ||
    meta.platform !== "linux-x64" ||
    !/^[\w.-]+$/.test(meta.buildId) ||
    !/^[a-zA-Z][a-zA-Z0-9-]+$/.test(meta.desktopExecutable)
  )
    throw new Error("Invalid release metadata.");
  const expected = [
    "cli.tar.gz",
    "desktop.tar.gz",
    "SOURCE-SHA256.json",
    "PAYLOAD-SHA256.json",
  ];
  const checks = (await readFile(join(directory, "SHA256SUMS"), "utf8"))
    .trimEnd()
    .split("\n");
  if (checks.length !== expected.length)
    throw new Error("Incomplete checksum list.");
  const seen = new Set();
  for (const line of checks) {
    const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9.-]+)$/.exec(line);
    if (!match || !expected.includes(match[2]) || seen.has(match[2]))
      throw new Error("Invalid or duplicate checksum record.");
    seen.add(match[2]);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(join(directory, match[2])))
      hash.update(chunk);
    if (hash.digest("hex") !== match[1])
      throw new Error(`Checksum mismatch: ${match[2]}`);
  }
  if (seen.size !== expected.length)
    throw new Error("Missing checksum record.");
  const sourceManifest = JSON.parse(
    await readFile(join(directory, "SOURCE-SHA256.json"), "utf8"),
  );
  if (sourceManifest.schema !== 1 || !Array.isArray(sourceManifest.source))
    throw new Error("Invalid source manifest.");
  const inventory = JSON.parse(
    await readFile(join(directory, "PAYLOAD-SHA256.json"), "utf8"),
  );
  if (inventory.schema !== 1 || !Array.isArray(inventory.entries))
    throw new Error("Invalid payload manifest.");
  const actual = [];
  async function walk(path, prefix) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}/${entry.name}`;
      const file = join(path, entry.name);
      const s = await lstat(file);
      if (s.isDirectory()) {
        actual.push({ path: name, type: "directory" });
        await walk(file, name);
      } else if (s.isFile()) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        actual.push({
          path: name,
          type: "file",
          bytes: s.size,
          sha256: hash.digest("hex"),
        });
      } else throw new Error(`Symlink or unsupported payload entry: ${name}`);
    }
  }
  for (const component of ["cli", "desktop"]) {
    if (!(await lstat(join(directory, component))).isDirectory())
      throw new Error(`Missing payload directory: ${component}`);
    await walk(join(directory, component), component);
    const listing = spawnSync(
      "tar",
      ["-tzf", join(directory, `${component}.tar.gz`)],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (listing.status !== 0 || listing.error)
      throw new Error(`Invalid ${component} archive.`);
    const names = listing.stdout.trimEnd().split("\n");
    if (
      names.some(
        (name) =>
          (!name.startsWith(`${component}/`) && name !== `${component}/`) ||
          name.split("/").some((part) => part === ".." || part === ".") ||
          name.startsWith("/"),
      )
    )
      throw new Error(`Unsafe ${component} archive path.`);
    const archived = names
      .map((name) => name.replace(/\/$/, ""))
      .filter((name) => name !== component)
      .sort();
    const tree = actual
      .filter((entry) => entry.path.startsWith(`${component}/`))
      .map((entry) => entry.path)
      .sort();
    if (JSON.stringify(archived) !== JSON.stringify(tree))
      throw new Error(`Archive inventory mismatch: ${component}`);
  }
  actual.sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (JSON.stringify(actual) !== JSON.stringify(inventory.entries))
    throw new Error("Payload inventory mismatch.");
  for (const file of [
    join(directory, "cli/cli.mjs"),
    join(directory, "desktop", meta.desktopExecutable),
  ]) {
    const s = await stat(file);
    if (!s.isFile() || !(s.mode & 0o111))
      throw new Error(`Not an executable file: ${file}`);
  }
  if (!(await stat(join(directory, "desktop/resources/app.asar"))).isFile())
    throw new Error("Missing app.asar.");
  for (const name of ["playwright", "playwright-core"]) {
    if (
      (await lstat(join(directory, "cli/node_modules", name))).isSymbolicLink()
    )
      throw new Error(`External CLI dependency is a symlink: ${name}`);
    await stat(join(directory, "cli/node_modules", name, "package.json"));
  }
  return meta;
}
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Linux x64 only.");
if (mode === "--rollback" && !/^[\w.-]+$/.test(operand))
  throw new Error("Invalid rollback build ID.");
const source =
  mode === "--rollback" ? join(releases, operand) : resolve(operand);
const meta = await validate(source);
if (mode === "--rollback" && meta.buildId !== operand)
  throw new Error("Rollback ID mismatch.");
const dest = join(releases, meta.buildId);
if (mode !== "--rollback" && (await exists(dest)))
  throw new Error(`Release already installed: ${dest}`);
if (mode === "--rollback" && !(await exists(dest)))
  throw new Error(`Unknown installed release: ${operand}`);
const target = join(base, "current");
const cliScript = `#!/bin/sh\nexec node ${quote(join(target, "cli/cli.mjs"))} "$@"\n`;
const desktopScript = `#!/bin/sh\nexec ${quote(join(target, "desktop", meta.desktopExecutable))} "$@"\n`;
const desktopFile = `[Desktop Entry]\nType=Application\nName=Forge\nComment=Local desktop agent harness\nExec=${desktopQuote(join(bin, "forge-desktop"))}\nTerminal=false\nCategories=Development;\n`;
const desired = [cliScript, desktopScript, desktopFile];
const conflicts = [];
for (let i = 0; i < paths.length; i++) {
  const s = await exists(paths[i]);
  if (s && (!s.isFile() || (await readFile(paths[i], "utf8")) !== desired[i]))
    conflicts.push(paths[i]);
}
const pointer = await exists(current);
if (pointer && !pointer.isSymbolicLink()) conflicts.push(current);
if (pointer?.isSymbolicLink()) {
  const { readlink } = await import("node:fs/promises");
  const link = await readlink(current);
  if (!isAbsolute(link) || !link.startsWith(releases + sep))
    conflicts.push(current);
}
if (conflicts.length)
  throw new Error(
    `Unrelated existing paths; refusing overwrite:\n${conflicts.join("\n")}`,
  );
process.stdout.write(
  `${mode}: ${source} -> ${dest}\nDesktop executable: ${meta.desktopExecutable}\n`,
);
if (mode === "--dry-run") {
  process.stdout.write("No files written.\n");
  process.exit(0);
}
await mkdir(releases, { recursive: true });
await mkdir(bin, { recursive: true });
await mkdir(applications, { recursive: true });
if (mode === "--install") {
  const stage = join(releases, `.stage-${process.pid}`);
  await cp(source, stage, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  try {
    await validate(stage);
    await rename(stage, dest);
  } catch (e) {
    await rm(stage, { recursive: true, force: true });
    throw e;
  }
}
for (let i = 0; i < paths.length; i++)
  if (!(await exists(paths[i])))
    await writeFile(paths[i], desired[i], {
      flag: "wx",
      mode: i === 2 ? 0o644 : 0o755,
    });
const next = join(base, `.current-${process.pid}`);
await symlink(dest, next);
try {
  await rename(next, current);
} catch (e) {
  await rm(next);
  throw e;
}
process.stdout.write(`Current release: ${meta.buildId}\n`);
