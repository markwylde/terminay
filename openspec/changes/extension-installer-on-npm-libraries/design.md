## Context

`NpmCliRegistryClient` (`packages/server-core/src/extensions/npmClient.ts`)
installs extensions by running the bundled npm 12.2.1 CLI through
`process.execPath` with `ELECTRON_RUN_AS_NODE=1`, a sterile `HOME`, cache, and
`userconfig`, a 120-second deadline, and a 2 MiB output cap. It issues four
kinds of command:

1. `npm view <spec> version --json` and `npm view <name>@<exact> ... --json`
   for resolution and preview metadata.
2. `npm install --package-lock-only --ignore-scripts --omit=dev
   --no-bin-links --workspaces=false --save-exact` to produce an exact lock.
3. `validateNpmLockfile` (Terminay code) rejects non-npmjs, git, file, link,
   remote, or integrity-less entries.
4. `npm ci --ignore-scripts --omit=dev --allow-git=none --no-bin-links` to
   materialize the validated lock.

Uploaded archives use the same path with a local tarball in place of the
registry spec.

npm vendors its dependency tree as `bundleDependencies`. The repository's
`overrides` cannot rewrite it, Dependabot cannot patch it, and the supply-chain
audit carries exact-path exceptions for it. Inside npm, `undici` arrives only
through `node-gyp` (via `@npmcli/run-script`), and `ip-address` through
`@npmcli/agent` → `socks-proxy-agent` → `socks`. npm 12.2.1 is itself built from
`pacote` ^22, `@npmcli/arborist` ^10.0.4, and `npm-registry-fetch` ^20, with the
same engines (`^22.22.2 || ^24.15.0 || >=26.0.0`) the bundled CLI already runs
under.

## Goals / Non-Goals

**Goals:**

- Every package that executes during extension installation is an ordinary,
  lockfile-recorded dependency the repository can override and audit.
- Installation behaviour visible to users is unchanged: same resolution, same
  preview metadata, same lock validation, same scripts-disabled materialization,
  same failure and receipt semantics.
- The installer's isolation is unchanged: bounded child process, sterile
  configuration, public npmjs only, no inherited credentials or proxies.

**Non-Goals:**

- Changing which packages or dependency shapes are accepted.
- Writing a Terminay package resolver or tarball extractor. npm's libraries do
  that; this change only stops shipping them inside the CLI.
- Changing the build toolchain. Developers and CI still use npm 12.2.1 per
  ADR-0078.
- Registry provenance or signature verification, which stays `unavailable` as
  today.

## Decisions

### 1. Use `pacote` and `@npmcli/arborist`, not a hand-written client

The CLI commands map one-to-one onto the libraries npm itself uses:

| Today | Replacement |
|---|---|
| `npm view` (version, metadata) | `pacote.manifest(spec, { fullMetadata: true })` |
| `npm install --package-lock-only` | `new Arborist(opts).reify({ packageLockOnly: true, save: true, saveType: 'prod', saveExact: true, add: [spec] })` |
| `npm ci` | `new Arborist(opts).loadVirtual()` then `reify()` from the lock, after deleting any `node_modules` |

Shared options: `registry: https://registry.npmjs.org/`, `cache` under the
installer's private directory, `ignoreScripts: true`, `binLinks: false`,
`omit: ['dev']`, `workspacesEnabled: false`, `audit: false`, `fund: false`,
`allowGit: 'none'`, no `//registry...:_authToken` keys, no `proxy`,
`httpsProxy`, or `noProxy`.

Alternative considered: a Terminay-written resolver and extractor on `fetch`
and `tar`. Rejected. Correct semver resolution, peer and optional handling,
platform filtering, and lockfile v3 output are exactly what Arborist exists to
do, and re-implementing them adds risk without removing code that executes.

Pin both libraries exactly in `packages/server-core`, on the 7-day cooldown, so
the installer version is reproducible.

### 2. Keep the installer in a bounded child process

Arborist runs in a Terminay-owned worker script
(`packages/server-core/src/extensions/installerWorker.ts`) spawned through
`process.execPath` with `ELECTRON_RUN_AS_NODE=1`, a scrubbed environment, a
private `HOME` and working directory, the existing 120-second deadline, and an
output cap. The parent sends one JSON request (`resolve` or `materialize`) and
reads one JSON result; all validation of the result stays in the parent.

This is the security and stability boundary the current design relies on:
registry and tarball parsing, proxy agents, and Arborist's filesystem work
never run in the server process, a hung or crashed install is killed by the
deadline without affecting the server, and the child sees no inherited
credentials or proxy variables. Running Arborist in-process was considered and
rejected for those reasons.

### 3. Sterility comes from explicit options, not a config file

The libraries do not read `.npmrc` unless given a loaded config, so the worker
passes a literal options object and never loads `@npmcli/config`. The scrubbed
environment still removes `npm_config_*`, `HTTP(S)_PROXY`, `NO_PROXY`, and
`NODE_OPTIONS`, so nothing reaches the libraries indirectly.

### 4. Overrides reach the installer tree

Root `overrides` gain `undici` at the fixed 6.x version and keep `ip-address`
at 10.7.4 or newer; both now apply because the installer tree is ordinary.
`node-gyp` stays in the tree through `@npmcli/run-script`, but never runs:
lifecycle scripts are disabled and trees containing `binding.gyp` are rejected
before materialization.

### 5. Receipts record installer version

`installerTypes.ts` replaces `npmVersion` with `installerVersion`, a string of
the form `arborist@<v> pacote@<v>` read from the libraries' `package.json` at
build time. Receipts that already record `npmVersion` are read as
`installerVersion: "npm@<v>"`; nothing is rewritten on disk.

### 6. The npm program leaves shipped artifacts

`npm` is removed from the shipped `dependencies` of the root and
`apps/terminay-server`. The standalone artifact check stops requiring an npm
installer pin and closure evidence; `scripts/bundled-npm-evidence.mjs`,
`scripts/task44-bundled-npm.test.mjs`, and the audit's bundled-npm exceptions
are deleted. A packaging check asserts no `node_modules/npm` exists in Desktop
or standalone outputs.

## Risks / Trade-offs

- [Arborist's API is less documented than the CLI] → Pin exact versions and
  add a parity test that installs fixture packages with both the old CLI path
  (dev-only, using the developer npm) and the new worker, comparing lock
  entries and installed inventory.
- [Behaviour drift on options the CLI derives implicitly, such as
  `allowGit` or platform filtering] → Name every option explicitly in one
  frozen object and cover git, file, alias, `binding.gyp`, optional-platform,
  and prebuilt `.node` fixtures in tests.
- [The installer can now diverge from npm's own release] → Accepted. That is
  the point: the repository patches its dependencies on its own schedule.
- [More direct dependencies in the server lockfile] → They were already shipped
  inside npm; the audit now sees them individually, which is the goal.

## Migration Plan

Ship as one change. Existing installed slots, active pointers, and receipts are
unaffected; only new installs use the worker. Rollback is reverting the change,
which restores the bundled CLI.

## Open Questions

- Whether pacote 22 honours `allowGit: 'none'` as npm 12's `--allow-git=none`
  does, or whether lock validation must remain the only git guard. Resolve in
  task 2.3 with a git-dependency fixture.
