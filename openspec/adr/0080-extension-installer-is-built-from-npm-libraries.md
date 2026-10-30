# ADR-0080: Build the extension installer from npm's libraries, keep the pinned toolchain baseline

Status: accepted, supersedes ADR-0078
Date: 2026-10-30
Supersedes: ADR-0078

## Context

ADR-0078 pinned Node 24.15.0 with npm 12.2.1 across every lane and made the
bundled extension installer the same pinned npm CLI. Its consequences record
that the repository cannot patch the bundled npm's own dependencies, so the
installer's advisory exposure lags each npm release. That has now held for
months: npm 12.2.1 ships `undici` 6.29.0 and `ip-address` 10.7.2 with open
advisories whose fixes are merged upstream but unreleased, and every Terminay
release carries them.

The installer uses only npm's registry lookup, lockfile generation, and
scripts-disabled install. npm publishes those as `pacote` and
`@npmcli/arborist`.

## Decision

1. The extension installer is built from `pacote` and `@npmcli/arborist`,
   pinned exactly as ordinary dependencies of the server, so every package in
   its tree is in the repository lockfile and reachable by `overrides`,
   Dependabot, and the release audit. Shipped Desktop and server artifacts do
   not contain the npm command-line program.
2. The installer runs in a bounded child process through the server's Node or
   Electron (`ELECTRON_RUN_AS_NODE=1`) with explicit sterile options, a
   scrubbed environment, public npmjs only, scripts disabled, and a deadline.
   Result validation stays in the server process.
3. The build and release baseline is unchanged from ADR-0078: Node 24.15.0
   with npm 12.2.1; CI and every Node-based container install that exact npm
   before materializing the lockfile; runtime, container, CI, release, and
   local version-manager pins move together. npm is a build tool, not a
   shipped component.

## Consequences

- An advisory in any installer dependency is fixed by an override or a version
  bump in this repository, without waiting for an npm release, and the audit
  carries no bundled-npm exceptions.
- Moving the npm toolchain pin no longer changes shipped code.
- Terminay owns the mapping from CLI flags to library options; the installer
  can drift from npm CLI behaviour and is covered by parity and fixture tests.
- Install receipts record installer library versions rather than an npm
  version.

## Evidence

- [extension-installer-on-npm-libraries-audit.md](./evidence/extension-installer-on-npm-libraries-audit.md)
