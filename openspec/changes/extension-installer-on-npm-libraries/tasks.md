## 1. Dependencies

- [x] 1.1 Add `pacote` 22.0.1 and `@npmcli/arborist` 10.0.4 (or the newest versions past the 7-day cooldown) as exact dependencies of `packages/server-core`; verify with `npm ls pacote @npmcli/arborist` showing one deduplicated copy each, outside any `node_modules/npm/` path.
- [x] 1.2 Confirm the installer tree resolves `undici` and `ip-address` to fixed versions, adding overrides only where it does not (none were needed: `@npmcli/run-script` pulls `node-gyp` 13.1.0 with `undici` 8.12.3, and the existing `ip-address` 10.7.4 override applies); verify with `npm ls undici ip-address` and `npm audit --omit=dev` reporting no `undici` or `ip-address` advisories.

## 2. Installer worker

- [x] 2.1 Add `packages/server-core/src/extensions/installerWorker.ts` that reads one JSON `resolve` or `materialize` request from stdin and writes one JSON result to stdout, using a single frozen options object (public registry, private cache, `ignoreScripts`, `binLinks: false`, `omit: ['dev']`, `workspacesEnabled: false`, `audit: false`, `fund: false`, `allowGit: 'none'`, no auth or proxy keys); verify with a unit test that the options object has exactly these keys.
- [x] 2.2 Implement `resolve` with `pacote.manifest(..., { fullMetadata: true })` returning the same fields `NpmCliRegistryClient.resolve` returns today; verify existing `npm-client.test.mjs` resolution cases pass against the new client.
- [x] 2.3 Implement `materialize` as Arborist `packageLockOnly` reify, parent-side `validateNpmLockfile`, then a clean reify from the lock, for registry and uploaded-archive sources; verify with fixtures for an exact package, a git dependency, a file dependency, an alias, a `binding.gyp` tree, an optional platform dependency, and a prebuilt `.node` module, each accepted or rejected as the extension-platform spec requires, and record whether `allowGit` alone blocks git.
- [x] 2.4 Replace `NpmCliRegistryClient` with a client that spawns the worker via `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, a scrubbed environment (no `npm_config_*`, proxy, or `NODE_OPTIONS` variables), private `HOME` and cwd, 120-second deadline, and output cap; verify with tests that a user `.npmrc` with a token and alternate registry is ignored, that proxy variables are not visible to the worker, and that a hung worker is killed at the deadline.

## 3. Receipts

- [x] 3.1 Replace `npmVersion` with `installerVersion` (`arborist@<v> pacote@<v>`) in `installerTypes.ts`, `installer.ts`, and `composition.ts`, reading receipts that carry `npmVersion` as `installerVersion: "npm@<v>"`; verify with installer and upgrade-recovery tests, including one that loads a pre-existing `npmVersion` receipt.

## 4. Remove the shipped npm program

- [x] 4.1 Remove `npm` from the shipped `dependencies` of the root and `apps/terminay-server`, keeping `packageManager` and `engines.npm` at 12.2.1; verify `npm ls npm --omit=dev` is empty.
- [x] 4.2 Remove the npm installer pin and closure-evidence check from `scripts/standalone-artifact.mjs`, delete `scripts/bundled-npm-evidence.mjs` and `scripts/task44-bundled-npm.test.mjs`, and add a check that no `node_modules/npm` exists in standalone or Desktop outputs; verify with `node --test scripts/standalone-artifact.test.mjs scripts/packaged-built-in-extension-runtime.test.mjs`.
- [x] 4.3 Remove the bundled-npm advisory exceptions from the supply-chain audit and record new evidence beside `openspec/adr/evidence/task20-supply-chain-audit.md`; verify `node scripts/task20-supply-chain-audit.mjs --npm-audit` and `node scripts/production-dependency-audit.mjs` pass with no exceptions.

## 5. Parity and end-to-end

- [x] 5.1 Add a dev-only parity test that installs the fixtures from 2.3 with the developer npm 12.2.1 CLI and with the worker, comparing lock entries (name, version, resolved, integrity) and installed file inventory; verify it passes.
- [x] 5.2 Run `npm run test:e2e` for the extension install, upload, update, and built-in override flows; verify every shard passes.
- [x] 5.3 Package Desktop for macOS and install a public package through the packaged app's installer worker; verify it installs under `ELECTRON_RUN_AS_NODE` with no app instance or window, that the bundled main resolves `installerVersion` from ASAR, and that `scripts/packaged-desktop-startup-smoke.test.mjs` asserts the worker and libraries ship, `node_modules/npm` does not, and an offline install succeeds through the packaged Electron.

## 6. Records

- [x] 6.1 Add ADR-0080 to `openspec/adr/README.md` and mark ADR-0078 superseded in the index; verify with `openspec validate --all`.
- [ ] 6.2 Open the pull request on origin and read back every commit status as `success` or `skipped`; then confirm the `undici` and `ip-address` Dependabot alerts close after the mirror syncs `main`.
