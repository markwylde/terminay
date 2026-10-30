# ADR-0078: Pin the Node runtime, toolchain, and compile targets across every lane, on npm 12.2.1

Status: accepted, supersedes ADR-0033
Date: 2026-10-30
Supersedes: ADR-0033

## Context

ADR-0033 pinned the build and release baseline to Node 24.15.0 with npm 12.2.0,
and recorded that the bundled npm 12.2.0 still carried `brace-expansion` 5.0.9,
`ip-address` 10.5.0, and `undici` 6.28.0 with open advisories. Its consequences
name an npm patch release that carries a security fix as a reason to move the
pin, and that moving it needs a new ADR only because the version is named.

npm 12.2.1 is the newest npm release. It bundles `brace-expansion` 5.0.12,
`postcss-selector-parser` 7.1.6, `ip-address` 10.7.2, and `undici` 6.29.0,
which clears every `brace-expansion` and `postcss-selector-parser` advisory and
all but one `ip-address` and four `undici` advisories.

The bundled npm's dependencies are `bundleDependencies`, so the repository's
`overrides` cannot reach them. Only an npm release moves them.

## Decision

The build and release baseline is Node 24.15.0 with npm 12.2.1. Every other
part of ADR-0033's decision stands unchanged: CI and every Node-based container
install that exact npm version before materializing the lockfile; runtime,
container, CI, release, and local version-manager pins move together; and the
bundled extension installer is the same pinned npm, moved with its recorded
version and supply-chain evidence in the same change.

## Consequences

- The installer child process carries fewer advisories, and the remaining ones
  stay confined to the bounded installer process described in the audit
  evidence.
- The repository still cannot patch the bundled npm's own dependencies, so the
  installer's advisory exposure lags each npm release.

## Open items

- npm 12.2.1 still bundles `ip-address` 10.7.2 (fixed in 10.7.4) and `undici`
  6.29.0 (fixed in 6.29.1). npm/cli merged `undici` 6.29.1 and `ip-address`
  10.7.5 on 2026-10-27, unreleased at the time of this decision. Move the pin
  again when an npm release carries them.
