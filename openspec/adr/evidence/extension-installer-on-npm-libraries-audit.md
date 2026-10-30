# Extension installer on npm libraries: dependency audit

Date: 2026-10-30

Evidence for [ADR-0080](../0080-extension-installer-is-built-from-npm-libraries.md).
It replaces the bundled-npm carrier exceptions recorded in
[task20-supply-chain-audit.md](./task20-supply-chain-audit.md); that record stays
as history.

## What changed in the tree

- `npm` is no longer a dependency of the root workspace or `@terminay/server`.
  `package-lock.json` has no `node_modules/npm` entry and no `inBundle` entry
  at all.
- `@terminay/server-core` and the Desktop root depend on `pacote` 22.0.1 and
  `@npmcli/arborist` 10.0.4, pinned exactly. Every package beneath them is an
  ordinary lockfile entry with its own integrity record.
- `undici` inside the installer tree comes from `node-gyp` 13.1.0 (through
  `@npmcli/run-script`) at 8.12.3. The other copies are 6.29.1 and 7.30.1.
  `ip-address` resolves to 10.7.4 everywhere, through the root override.
  No new override was needed.

## Commands and results

```sh
npm audit --omit=dev     # 0 vulnerabilities
npm audit                # 0 vulnerabilities, development tooling included
npm ls undici ip-address --all
node scripts/task20-supply-chain-audit.mjs
node --test scripts/task20-supply-chain-audit.test.mjs
```

- `npm audit --omit=dev` and `npm audit` both report zero advisories at every
  severity.
- The supply-chain audit reports 999 lockfile entries and 46 native records,
  with no unresolved integrity or license metadata and no bundled carrier.
- No advisory exception exists in the release audit, for npm or any other
  package.

## Installer behaviour checks

- `packages/server-core/test/npm-client.test.mjs` runs the real worker against
  uploaded archives: git, remote-tarball, and file dependencies are refused
  with `EALLOWGIT`, `EALLOWREMOTE`, and `EALLOWFILE` before any fetch, and an
  archive declaring an install script and a bin installs without running the
  script or linking the bin.
- The same suite confirms the worker receives only `ELECTRON_RUN_AS_NODE`,
  `HOME`, `NODE_ENV`, `TERMINAY_INSTALLER_WORKER`, and `TMPDIR`, even with
  `npm_config_*`, proxy, `NODE_OPTIONS`, and token variables set in the server,
  and that a hung worker is killed at its deadline.
- A live install of `chalk@^5` from npmjs resolved 5.6.2, matching what
  `npm view chalk@^5 version` reports as highest, and materialized the
  validated lock unchanged.
