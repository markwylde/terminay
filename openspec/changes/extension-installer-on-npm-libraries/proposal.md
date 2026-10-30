## Why

Terminay ships known-vulnerable code it cannot fix. Users and security scanners
see open advisories against every Desktop and Server release, and the only fix
the project can apply is to wait for npm to cut a release. The cause is the
extension installer: it runs the npm CLI, and npm ships its dependencies as
`bundleDependencies`, so the repository's `overrides` and audit cannot reach
them. npm 12.2.1 still carries `undici` 6.29.0 and `ip-address` 10.7.2; the
fixes were merged upstream on 2026-10-27 and are unreleased. This has recurred
every time an advisory lands in a package npm vendors.

The installer uses only a small part of npm: registry metadata lookup, an exact
lockfile, and a scripts-disabled clean install. npm publishes those pieces as
libraries (`pacote`, `@npmcli/arborist`). Installed as ordinary dependencies,
every package beneath them is in the repository lockfile, where overrides,
Dependabot, and the release audit can patch it the same day.

## What Changes

- The extension installer is rebuilt on `pacote` and `@npmcli/arborist` as
  ordinary server dependencies. It no longer runs the npm CLI.
- The installer still runs in a bounded child process with a sterile,
  Terminay-owned configuration fixed to public npmjs, lifecycle scripts
  disabled, no binary links, and development dependencies omitted. Under
  Desktop it still runs through the Electron executable with
  `ELECTRON_RUN_AS_NODE=1`.
- The `npm` package leaves the shipped server and Desktop dependencies, along
  with the bundled-npm closure evidence and its audit exceptions. Build tooling
  keeps the pinned npm as a developer and CI tool only.
- Repository overrides pin `undici` and `ip-address` to fixed versions inside
  the installer's tree.
- Install receipts record the installer's identity and library versions instead
  of an npm CLI version. Existing receipts that record `npmVersion` stay
  readable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `extension-platform`: the sterile installer is built from npm's package
  libraries as ordinary dependencies the repository audits and patches, not a
  bundled npm CLI; receipts record installer version.
- `server-runtime-and-protocol`: extension runtime hosting includes the
  extension installer rather than a pinned npm installer.

## Impact

- Code: `packages/server-core/src/extensions/npmClient.ts` (replaced by a
  library-backed client and an installer worker entry point),
  `installer.ts` and `installerTypes.ts` (receipt field), `composition.ts`.
- Dependencies: adds `pacote` ^22 and `@npmcli/arborist` ^10 to the server and
  root; removes `npm` from shipped dependencies of the root and
  `apps/terminay-server`; adds overrides for `undici` and `ip-address`.
- Build and release: `scripts/standalone-artifact.mjs` (drops the npm installer
  pin and closure-evidence check), `scripts/bundled-npm-evidence.mjs` and
  `scripts/task44-bundled-npm.test.mjs` (removed), the supply-chain audit and
  its evidence (bundled-npm exceptions removed), Desktop packaging.
- Tests: `packages/server-core/test/npm-client.test.mjs`, installer, upload,
  upgrade-recovery, and built-in installer tests; packaged runtime tests; E2E
  extension install flows.
- ADRs: a new ADR supersedes ADR-0078 for the installer clause.
