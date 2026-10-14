#!/usr/bin/env node
import { createHash } from "node:crypto";
// Public, content-addressed inventory only. Raw development audit logs stay local.
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const help =
  "Usage: node scripts/provenance.mjs --output PATH\nWrites a public source SHA256 inventory. Never includes raw prompts, transcripts or credentials.\n";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(help);
  process.exit(0);
}
if (args.length !== 2 || args[0] !== "--output") {
  process.stderr.write(help);
  process.exit(2);
}
const output = resolve(args[1]);
if (
  output === root ||
  !output.startsWith(root + sep) ||
  !relative(root, output).startsWith(`release${sep}`) ||
  relative(root, output)
    .split(sep)
    .some((part) => part === ".." || part === ".build" || part === ".omo")
) {
  throw new Error("Output must be below the repository release/ directory.");
}
const files = [];
const bases = ["src", "scripts", "docs", "tests", "examples"];
for (const name of bases) {
  async function visit(path) {
    for (const entry of await readdir(resolve(root, path), {
      withFileTypes: true,
    })) {
      const child = `${path}/${entry.name}`;
      if (entry.name.startsWith(".") || entry.isSymbolicLink())
        throw new Error(
          `Private/hidden or symlink source entry refused: ${child}`,
        );
      if (name === "examples") {
        const directories = [
          "examples/mcp",
          "examples/skills",
          "examples/skills/test-driven-repair",
        ];
        const allowedFile =
          (child.startsWith("examples/mcp/") && /\.(mjs|md)$/.test(child)) ||
          (child.startsWith("examples/skills/test-driven-repair/") &&
            child.endsWith(".md"));
        if (entry.isDirectory() && directories.includes(child))
          await visit(child);
        else if (entry.isFile() && allowedFile) files.push(child);
        else throw new Error(`Unallowlisted example source entry: ${child}`);
      } else if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`Unsupported source entry: ${child}`);
    }
  }
  await visit(name);
}
for (const name of [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "biome.json",
  "README.md",
  "DESIGN.md",
]) {
  if ((await lstat(resolve(root, name)).catch(() => null))?.isFile())
    files.push(name);
}
files.sort();
const source = [];
for (const path of files) {
  const data = await readFile(resolve(root, path));
  source.push({
    path,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
  });
}
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = {
  schema: 1,
  name: pkg.name,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  source,
  audit: {
    localEvidence:
      ".build/runtime-runs/*.jsonl and .build/api-authored (NOT distributed)",
    description:
      "See docs/AUTHORSHIP.md; hashes inventory file contents, not formal per-line authorship attestations.",
  },
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
  mode: 0o644,
});
process.stdout.write(`Inventoried ${files.length} source files: ${output}\n`);
