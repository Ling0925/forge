# Delivery: install, verify and roll back (Linux x64, Node 22)

This document is for someone **installing a Forge release**. It describes the release layout, how
to verify a release you received, how to install it, and how to roll back. It performs no build,
release or installation itself.

- Target: **Linux x64 only.**
- CLI: requires a system Node `>=22.23.1 <23`. The CLI is a Node script (`cli/cli.mjs`), **not** a
  standalone binary.
- Desktop: the archive bundles Electron (locked to Electron 44 at build time). No separate Electron
  install is needed.
- Browser tools: require host OS graphics libraries and a Chromium matching the installed Playwright
  version. The browser binary is **not** bundled; see "Browser prerequisite" below.

## What a release contains

A release directory `release/<build-id>/` contains loose `cli/` and `desktop/` trees, their
`cli.tar.gz` and `desktop.tar.gz`, plus `SHA256SUMS`, `SOURCE-SHA256.json`, `PAYLOAD-SHA256.json`
and `release.json`. Each archive contains only its same-named top-level tree.

**Both** `cli/` and `desktop/` contain `README.md`, all regular `docs/*.md`,
`examples/mcp/*.{mjs,md}` and `examples/skills/test-driven-repair/*.md`, at identical paths relative
to their tree root. These directories are explicit allowlists; unexpected entries or symlinks fail
packaging rather than being silently distributed. CLI also contains `cli.mjs`,
`node_modules/playwright`, `node_modules/playwright-core` and `NOTICE.txt`; desktop contains Electron
resources and the executable.

The release root is metadata only, not the documentation home. README's relative `docs/` links
resolve from **either extracted tree's README**, even after relocation. Repository-only scripts,
tests, `dist`, local review logs and development manifests are **not** present in those trees.

## Verify a release you received

```sh
# 1) Check the archives and inventory against the published checksums.
build_id="YOUR-INSTALLED-BUILD-ID"
cd "release/$build_id"
sha256sum -c SHA256SUMS

# 2) Inspect the metadata.
cat release.json
# SOURCE-SHA256.json inventories the allowlisted repository src/, scripts/, docs/, tests/,
# examples/ and root manifests/README/DESIGN by content hash. It is NOT a source archive or
# authorship proof and includes no raw API/tool transcripts.
```

The installer contract is: exactly four checksummed files (`cli.tar.gz`, `desktop.tar.gz`,
`SOURCE-SHA256.json`, `PAYLOAD-SHA256.json`); every regular file in **both loose installable
payloads**, including docs, examples, notices and dependencies, is listed with size and hash in the
checksummed `PAYLOAD-SHA256.json`. It rejects symlinks/unsupported entries and verifies the archive
path-name inventory against the loose tree; it does **not** re-extract archives and compare byte
contents. The tarballs themselves are SHA256-checked.

Archives vary in timestamps/build ID and are **not signed or byte-for-byte reproducible**. A
checksum proves file bytes matched a manifest, not authorship or availability.

## Install

Installing uses the **source checkout's** installer script (`scripts/install-local.mjs`), which is
**not** part of the extracted release payload. Run it from the checkout root against a verified
release directory. The installer only ever writes under `~/.local/share/forge-harness/releases`,
`~/.local/bin/forge{,-desktop}` and `~/.local/share/applications/forge.desktop`; it keeps older
installed releases, uses no sudo, and performs no autostart, background service or uninstall.

```sh
build_id="YOUR-BUILD-ID"

# 1) Dry run first: validates the release directory and checksums; writes nothing.
node scripts/install-local.mjs --dry-run "release/$build_id"

# 2) Then install: copies to ~/.local/share/forge-harness/releases/<build-id>, retains older
#    releases, points the `current` symlink and writes the launchers/desktop entry.
node scripts/install-local.mjs --install "release/$build_id"
```

Re-check the archives and inventory without changing the checkout directory (so the relative
`scripts/install-local.mjs` path above still resolves) by running the checksum step in a subshell:

```sh
( cd "release/$build_id" && sha256sum -c SHA256SUMS )
```

After installing, confirm the launchers. The installed CLI's `--help` is authoritative for the
options the installed build actually has:

```sh
"$HOME/.local/bin/forge" --help           # installed CLI options
"$HOME/.local/bin/forge-desktop"          # launches the packaged desktop app
```

### Managing the installation

The launchers on the user PATH point at the `current` release. Use the absolute immutable release
directory (preferably not a movable `current` link when registering a persistent example):

```sh
installed="$HOME/.local/share/forge-harness/releases/$build_id"

# Register the stdio MCP example with the actual CLI operation, an explicit Node command
# and an absolute argument:
node "$installed/cli/cli.mjs" mcp register echo "Local echo" node "$installed/cli/examples/mcp/echo-server.mjs"

# The skill example is a template: copy its SKILL.md into a chosen WORKSPACE's
# .forge/skills/test-driven-repair/SKILL.md, then open that workspace in Forge.
# Read $installed/cli/docs/MCP.md and $installed/cli/docs/CONTEXT.md for details.
```

Check the installed CLI's `--help` before registering: the operation is `mcp register`, not
`mcp add`. Registration alone does not launch a server; enabling alone does not launch it either —
an explicit `enable` and then a discovery/call/health action are required. The skill example is
**not** automatically installed into any workspace. For a desktop-only archive use
`$installed/desktop/examples/...` instead.

Commands in the source repository's `docs/*.md` that call `node scripts/*.mjs` (including this
installer) require the checkout's `scripts/`, which are **not** in the installed payload. The copied
document is reference material, not an installed management command.

### Archive-only install (no source checkout)

If you only have the extracted payloads (for example you unrolled `cli.tar.gz` and `desktop.tar.gz`
by hand), run them directly instead of using the installer:

```sh
node ./cli/cli.mjs --help
node ./cli/cli.mjs mcp register echo "Local echo" node "$PWD/cli/examples/mcp/echo-server.mjs"
./desktop/forge-desktop
```

The installer (`scripts/install-local.mjs`) lives in the source checkout and is **not** present in
the extracted `cli/` or `desktop/` trees, so archive-only users skip it and point their own launcher
at the extracted tree. This path manages no `current` symlink and keeps no rollback bookkeeping.

The installer contract:

- checks executable modes, `app.asar` and CLI external dependencies before changing the `current`
  symlink;
- copies to `~/.local/share/forge-harness/releases/<build-id>`, preserves older releases, uses
  absolute quoted launchers and a user desktop entry, and refuses unrelated existing path conflicts;
- performs no sudo, autostart, background service or arbitrary uninstall.

## Roll back

A rollback does not delete old release directories; it explicitly selects the desired build path.
Set `previous_build_id` to an actual retained build ID:

```sh
previous_build_id="YOUR-PREVIOUS-BUILD-ID"
node scripts/install-local.mjs --rollback "$previous_build_id"   # from the source checkout
```

If you only have an installed tree, point `forge`/`forge-desktop` at the desired
`~/.local/share/forge-harness/releases/<build-id>/` you want to use; older releases remain on disk.

## Browser prerequisite (installed Playwright)

The Playwright JavaScript packages ship in the release (verified as `cli/node_modules/playwright`
and `cli/node_modules/playwright-core`), so `cli/cli.mjs` works for local-only runs without a
browser. Browser tools need an actual Chromium matching the installed Playwright version (1.64.0 as
declared by the lockfile). A source checkout can use `pnpm browser:install` (also
`pnpm exec playwright install chromium`). An installed/archive-only user does **not** need the
source checkout: the payload ships the same Playwright CLI, so run it from the payload's own
dependency to download the matching Chromium:

```sh
# Installed tree (or any extracted cli/ payload); set installed as in "Install" above:
node "$installed/cli/node_modules/playwright/cli.js" install chromium
```

Provide one of:

- an installed Chromium for that Playwright version, or
- an explicit `FORGE_BROWSER_EXECUTABLE` pointing at a compatible browser.

Browser tools also require host OS libraries and a working graphics environment. The browser binary
is **not** bundled by default; do not hard-code a cached browser revision or assume a QA browser
installed on the build host ships with the archive. Browser automation reaches only the exact
origins configured at runtime (no wildcards); see [BROWSER_TOOLS.md](BROWSER_TOOLS.md).

## Development build (source checkout only)

These commands exist **only in a source checkout** and are not part of the installed payload:

```sh
node scripts/release.mjs --help
node scripts/release.mjs --dry-run        # checks configuration and Playwright resolution; no writes
node scripts/release-selfcheck.mjs        # temporary fixtures; no real install/build
node scripts/release.mjs --build          # after source freeze, with no concurrent source writes
node scripts/install-local.mjs --install "release/<build-id>"
```

`--build` invokes the build then electron-builder Linux dir; it verifies the configured
`forge-desktop` executable, `app.asar`, CLI `--help` and relocated Playwright imports. It also
writes `SOURCE-SHA256.json`, `PAYLOAD-SHA256.json`, `SHA256SUMS`, `release.json` and both tarballs.
No completed-artifact claim follows from dry-run or fixture checks.

## Honest limits (environment-dependent)

- **Linux x64 only.** Windows/macOS and non-x64 are not supported targets.
- **CLI needs system Node 22** (`>=22.23.1 <23`).
- **Browser binaries are not shipped**; a matching Chromium or `FORGE_BROWSER_EXECUTABLE` is
  required for browser tools, as is a working graphics environment.
- Archives are **not signed or byte-for-byte reproducible**.
- Some live verification of Forge behavior was performed against a user-authorized gateway and a
  native Electron build; those records are bounded evidence of behavior, not a claim that a given
  release artifact passed installation on your machine.
- Do not package or distribute `.build`, `.omo`, local state, private endpoints/keys, author
  prompts/logs, QA workspaces, debug directories or user sessions. Before distribution, inspect the
  actual desktop resources and third-party notices, and scan for credentials.
