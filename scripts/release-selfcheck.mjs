#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
// Self-check: provenance containment and installer payload binding, using temp fixtures only.
// Writes nothing outside a temporary directory; performs no real install.
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const installer = join(root, "scripts", "install-local.mjs");
const provenance = join(root, "scripts", "provenance.mjs");
const run = (file, args) =>
  spawnSync(process.execPath, [file, ...args], { encoding: "utf8" });
const digest = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
let failures = 0;
function expect(name, ok, detail) {
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: ${detail}`}\n`,
  );
  if (!ok) failures++;
}

const tmp = await mkdtemp(join(tmpdir(), "forge-release-selfcheck-"));
await mkdir(join(root, "release"), { recursive: true });
const releaseParent = await mkdtemp(join(root, "release", ".selfcheck-"));
const releaseProbe = join(releaseParent, "probe");
const sentinel = join(releaseParent, "unrelated.txt");
try {
  await mkdir(releaseProbe);
  await writeFile(sentinel, "unrelated fixture, must survive\n", {
    flag: "wx",
  });
  // 1. Provenance: valid release output accepted, outside rejected.
  // All fixtures live inside our unique owned parent, never at fixed release paths.
  const okAllowed = run(provenance, [
    "--output",
    join(releaseProbe, "SOURCE-SHA256.json"),
  ]);
  expect(
    "provenance accepts output under repository release/",
    okAllowed.status === 0,
    okAllowed.stderr,
  );
  if (okAllowed.status === 0) {
    const paths = new Set(
      JSON.parse(
        await readFile(join(releaseProbe, "SOURCE-SHA256.json"), "utf8"),
      ).source.map((item) => item.path),
    );
    expect(
      "provenance includes documentation and runnable examples",
      [
        "docs/DELIVERY.md",
        "docs/REFERENCE_DESIGN.md",
        "examples/mcp/echo-server.mjs",
        "examples/skills/test-driven-repair/SKILL.md",
      ].every((path) => paths.has(path)),
      [...paths].filter((path) => path.startsWith("examples/")).join(", "),
    );
    expect(
      "provenance excludes local review logs",
      !paths.has("REVIEW_LOG.md") &&
        !paths.has("IMPLEMENTATION_NOTES.md") &&
        [...paths].every(
          (path) => !/(^|\/)(\.build|\.omo|release|\.local)(\/|$)/.test(path),
        ),
      "unexpected private path",
    );
  }
  const existingOutput = join(releaseProbe, "existing-SOURCE-SHA256.json");
  const original = Buffer.from("existing output fixture, must survive\n");
  await writeFile(existingOutput, original, { flag: "wx" });
  const refused = run(provenance, ["--output", existingOutput]);
  const after = await readFile(existingOutput).catch(() => null);
  expect(
    "provenance refuses existing output without changing original bytes",
    refused.status !== null &&
      refused.status !== 0 &&
      /EEXIST/.test(refused.stderr) &&
      after !== null &&
      after.equals(original),
    refused.stderr,
  );
  await rm(releaseProbe, { recursive: true });
  const kept = await readFile(sentinel, "utf8").catch(() => null);
  expect(
    "selfcheck preserves unrelated existing release fixture",
    kept === "unrelated fixture, must survive\n",
    String(kept),
  );
  const bad = run(provenance, ["--output", join(tmp, "SOURCE-SHA256.json")]);
  expect(
    "provenance rejects output outside release/",
    bad.status !== 0 && /release/.test(bad.stderr),
    bad.stderr,
  );

  // 2. Build a complete valid release fixture matching the installer's contract.
  async function makeFixture(dir) {
    await mkdir(join(dir, "cli", "node_modules", "playwright"), {
      recursive: true,
    });
    await mkdir(join(dir, "cli", "node_modules", "playwright-core"), {
      recursive: true,
    });
    await mkdir(join(dir, "desktop", "resources"), { recursive: true });
    for (const component of ["cli", "desktop"]) {
      for (const folder of [
        "docs",
        "examples/mcp",
        "examples/skills/test-driven-repair",
      ])
        await mkdir(join(dir, component, folder), { recursive: true });
      for (const name of [
        "README.md",
        "docs/REFERENCE_DESIGN.md",
        "docs/DELIVERY.md",
        "examples/skills/test-driven-repair/SKILL.md",
        "examples/mcp/echo-server.mjs",
      ])
        await writeFile(
          join(dir, component, name),
          `public fixture: ${name}\n`,
        );
    }
    await writeFile(
      join(dir, "cli", "cli.mjs"),
      '#!/usr/bin/env node\nprocess.stdout.write("forge cli fixture\\n");\n',
      { mode: 0o755 },
    );
    for (const dep of ["playwright", "playwright-core"])
      await writeFile(
        join(dir, "cli", "node_modules", dep, "package.json"),
        JSON.stringify({ name: dep, version: "1.0.0" }),
      );
    await writeFile(
      join(dir, "desktop", "forge-desktop"),
      "#!/bin/sh\necho desktop\n",
      { mode: 0o755 },
    );
    await writeFile(
      join(dir, "desktop", "resources", "app.asar"),
      "fixture asar\n",
    );
    await writeFile(
      join(dir, "release.json"),
      JSON.stringify({
        schema: 1,
        buildId: "selfcheck-1",
        version: "0.0.0",
        builtAt: new Date().toISOString(),
        platform: "linux-x64",
        desktopExecutable: "forge-desktop",
        cliNode: ">=22.23.1 <23",
      }),
    );
    // Payload inventory in the same format/order as scripts/release.mjs payloadInventory.
    const entries = [];
    async function walk(path, prefix) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const name = `${prefix}/${entry.name}`;
        const file = join(path, entry.name);
        const s = await lstat(file);
        if (s.isDirectory()) {
          entries.push({ path: name, type: "directory" });
          await walk(file, name);
        } else
          entries.push({
            path: name,
            type: "file",
            bytes: s.size,
            sha256: await digest(file),
          });
      }
    }
    await walk(join(dir, "cli"), "cli");
    await walk(join(dir, "desktop"), "desktop");
    entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
    await writeFile(
      join(dir, "PAYLOAD-SHA256.json"),
      `${JSON.stringify({ schema: 1, entries })}\n`,
    );
    await writeFile(
      join(dir, "SOURCE-SHA256.json"),
      JSON.stringify({ schema: 1, source: [] }),
    );
    for (const component of ["cli", "desktop"]) {
      const tar = spawnSync("tar", [
        "-C",
        dir,
        "-czf",
        join(dir, `${component}.tar.gz`),
        component,
      ]);
      if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
    }
    const lines = [];
    for (const name of [
      "cli.tar.gz",
      "desktop.tar.gz",
      "SOURCE-SHA256.json",
      "PAYLOAD-SHA256.json",
    ])
      lines.push(`${await digest(join(dir, name))}  ${name}`);
    await writeFile(join(dir, "SHA256SUMS"), `${lines.join("\n")}\n`);
  }

  const good = join(tmp, "good");
  await mkdir(good, { recursive: true });
  await makeFixture(good);
  const dry = run(installer, ["--dry-run", good]);
  expect(
    "installer dry-run accepts valid fixture",
    dry.status === 0 && /No files written/.test(dry.stdout),
    dry.stderr + dry.stdout,
  );

  const payload = JSON.parse(
    await readFile(join(good, "PAYLOAD-SHA256.json"), "utf8"),
  );
  expect(
    "both payloads hash documentation and examples",
    ["cli", "desktop"].every((component) =>
      [
        "README.md",
        "docs/DELIVERY.md",
        "docs/REFERENCE_DESIGN.md",
        "examples/mcp/echo-server.mjs",
        "examples/skills/test-driven-repair/SKILL.md",
      ].every((name) =>
        payload.entries.some(
          (entry) =>
            entry.path === `${component}/${name}` &&
            entry.type === "file" &&
            /^[a-f0-9]{64}$/.test(entry.sha256),
        ),
      ),
    ),
    "missing hashed asset",
  );
  const assetDrift = join(tmp, "asset-drift");
  await mkdir(assetDrift);
  await cp(good, assetDrift, { recursive: true });
  await writeFile(
    join(assetDrift, "cli/docs/DELIVERY.md"),
    "changed documentation\n",
  );
  const assetRun = run(installer, ["--dry-run", assetDrift]);
  expect(
    "installer rejects modified documentation with unchanged checksums",
    assetRun.status !== 0 && /mismatch/i.test(assetRun.stderr),
    assetRun.stderr,
  );

  // 3. Negative: exactly four records but a duplicated name replaces desktop.tar.gz,
  // so unique-name validation (not record count) must reject it.
  const dup = join(tmp, "dup");
  await mkdir(dup, { recursive: true });
  await cp(good, dup, { recursive: true });
  const dupHash = await digest(join(dup, "cli.tar.gz"));
  const dupLines = (await readFile(join(dup, "SHA256SUMS"), "utf8"))
    .split("\n")
    .filter(Boolean);
  const replaced = dupLines.map((line) =>
    line.endsWith("  desktop.tar.gz") ? `${dupHash}  cli.tar.gz` : line,
  );
  await writeFile(join(dup, "SHA256SUMS"), `${replaced.join("\n")}\n`);
  const dupRun = run(installer, ["--dry-run", dup]);
  expect(
    "installer rejects duplicate checksum record name",
    dupRun.status !== 0 && /duplicate checksum record/.test(dupRun.stderr),
    dupRun.stderr,
  );

  // 4. Negative: tampered loose tree with valid archives (payload drift).
  const drift = join(tmp, "drift");
  await mkdir(drift, { recursive: true });
  await cp(good, drift, { recursive: true });
  await writeFile(join(drift, "cli", "cli.mjs"), "arbitrary replacement\n", {
    mode: 0o755,
  });
  const driftRun = run(installer, ["--dry-run", drift]);
  expect(
    "installer rejects payload drift from manifest",
    driftRun.status !== 0 && /mismatch/i.test(driftRun.stderr),
    driftRun.stderr,
  );

  // 5. Negative: symlink inside loose payload.
  const link = join(tmp, "link");
  await mkdir(link, { recursive: true });
  await cp(good, link, { recursive: true });
  await symlink("/etc/passwd", join(link, "cli", "evil"));
  const linkRun = run(installer, ["--dry-run", link]);
  expect(
    "installer rejects payload symlink",
    linkRun.status !== 0,
    linkRun.stdout,
  );
} finally {
  await rm(releaseParent, { recursive: true, force: true });
  await rm(tmp, { recursive: true, force: true });
}
if (failures) {
  process.stderr.write(`${failures} self-check failure(s).\n`);
  process.exit(1);
}
process.stdout.write("All release self-checks passed.\n");
