import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { root } from "./modules.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "forge shell "));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await cp(join(root, "scripts"), join(directory, "scripts"), { recursive: true });
  for (const module of ["core", "cli"]) {
    await mkdir(join(directory, `repos/forge-${module}/scripts`), { recursive: true });
  }
  await mkdir(join(directory, "dist"));
  await writeFile(join(directory, "dist/cli.mjs"), "previous launcher\n");
  await writeFile(join(directory, "repos/forge-core/scripts/build.mjs"),
    'import { writeFileSync } from "node:fs"; writeFileSync("built", "current Core");');
  await writeFile(join(directory, "repos/forge-cli/scripts/build-core.mjs"), `
    import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
    if (readFileSync("node_modules/@forge/core/built", "utf8") !== "current Core") process.exit(9);
    mkdirSync("dist", { recursive: true });
    writeFileSync("dist/cli.mjs", 'console.log(JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}));');
  `);
  return directory;
}

function invoke(directory, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: directory,
    env: { PATH: process.env.PATH, HOME: directory, FORGE_HOME: join(directory, "state") },
    encoding: "utf8",
    timeout: 15000,
  });
  if (result.error) throw result.error;
  return result;
}

test("build uses sibling Core and the launcher preserves arguments and caller directory", async t => {
  const directory = await fixture(t);
  const built = invoke(directory, ["scripts/build-core.mjs"]);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(await realpath(join(directory, "repos/forge-cli/node_modules/@forge/core")),
    join(directory, "repos/forge-core"));
  const workspace = join(directory, "project with spaces");
  await mkdir(workspace);
  const launched = invoke(workspace, [join(directory, "dist/cli.mjs"), "sessions", "--json"]);
  assert.equal(launched.status, 0, launched.stderr);
  assert.deepEqual(JSON.parse(launched.stdout), { args: ["sessions", "--json"], cwd: workspace });
});

for (const module of ["core", "cli"]) {
  test(`failed ${module} build preserves the previous installed launcher`, async t => {
    const directory = await fixture(t);
    const script = module === "core" ? "build.mjs" : "build-core.mjs";
    await writeFile(join(directory, `repos/forge-${module}/scripts/${script}`), "process.exit(7);");
    const result = invoke(directory, ["scripts/build-core.mjs"]);
    assert.equal(result.status, 7, result.stderr);
    assert.equal(await readFile(join(directory, "dist/cli.mjs"), "utf8"), "previous launcher\n");
  });
}

test("a missing module fails without falling back to archived sources", async t => {
  const directory = await fixture(t);
  await rm(join(directory, "repos/forge-core"), { recursive: true });
  const result = invoke(directory, ["scripts/build-core.mjs"]);
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(join(directory, "dist/cli.mjs"), "utf8"), "previous launcher\n");
});

test("Web entrypoints delegate arguments to the Web module", async t => {
  const directory = await fixture(t);
  await mkdir(join(directory, "repos/forge-web-ui/scripts"), { recursive: true });
  for (const name of ["dev", "serve"]) {
    await writeFile(join(directory, `repos/forge-web-ui/scripts/${name}.mjs`),
      'console.log(JSON.stringify(process.argv.slice(2)));');
    const args = ["--core-url", "http://127.0.0.1:5175", "--port", "5199"];
    const result = invoke(directory, [`scripts/${name}-web.mjs`, ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  }
});
