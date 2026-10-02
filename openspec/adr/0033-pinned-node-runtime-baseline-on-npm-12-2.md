# ADR-0033: Pin the Node runtime, toolchain, and compile targets across every lane, on npm 12.2.0

Status: accepted, supersedes ADR-0001
Date: 2026-10-02
Supersedes: ADR-0001

## Context

ADR-0001 pinned the build and release baseline to Node 24.15.0 with npm 12.0.2,
and named that exact npm version in its decision. Its reasoning stands: every
lane must resolve the same Node and npm, and the lockfile must be materialized
by the npm that produced it.

npm is also a shipped dependency. Terminay bundles the pinned npm as the
extension installer, so advisories against the packages inside the npm archive
are advisories against a Terminay artifact. The supply-chain audit accepted
four temporary high-severity exceptions confined to the bundled npm 12.0.2
process (`brace-expansion`, `ip-address`, `npm`, and `tar`) on the condition
that each is removed when an upstream npm release carries the fix. See
[the audit evidence](./evidence/task20-supply-chain-audit.md).

npm 12.2.0 carries the fixed `tar`, which clears the `npm` and `tar`
exceptions. The pin cannot move without revisiting ADR-0001, because the
version is part of that decision.

## Decision

The build and release baseline is Node 24.15.0 with npm 12.2.0. CI and every
Node-based container install that exact npm version before materializing the
lockfile, so the toolchain cannot drift with a base-image refresh. Runtime,
container, CI, release, and local version-manager pins move together.

The bundled extension installer is the same pinned npm. Moving the pin moves
the installer, its recorded version, and its supply-chain evidence in the same
change.

TypeScript compiles active application code for ES2022 and esbuild targets
Node 24. Active build configuration must not retain a Node 22 target.

Platform artifacts include a pinned Node runtime rather than relying on a
machine-global Node installation. Desktop embeds the same packaged server
payload that is distributed for standalone use.

## Consequences

- The runtime version is a single coordinated change: moving Node or npm means
  moving the container, CI, release, and version-manager pins in one step.
- An npm patch or minor release that carries a security fix is a reason to move
  the pin, and doing so needs a new ADR only because the version is named here.
- Standalone and Desktop distributions grow by the size of the bundled Node
  runtime, in exchange for not depending on whatever Node the target machine
  happens to have.
- There is exactly one server payload to qualify, because Desktop supervises
  the same artifact that standalone users run.

## Open items

- npm 12.2.0 still bundles `brace-expansion` 5.0.9, `ip-address` 10.5.0, and
  `undici` 6.28.0, each with open advisories and no patched npm 12.x release.
  They stay confined to the bounded installer child process described in the
  audit evidence. Move the pin again when an npm release carries the fixes.
