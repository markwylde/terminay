## 1. Installer and store

- [x] 1.1 Package the pinned npm installer with Desktop-embedded, standalone x64/arm64, and Docker servers without introducing a system npm or compiler dependency, verified by per-artifact packaging checks.
- [x] 1.2 Build sterile npmjs-only resolve/preview/confirm with exact lock and integrity, scripts-disabled staging, bounded tree validation, immutable slots, receipts, atomic activation, crash recovery, and cleanup, verified by transactional pipeline tests including interrupted installs.
- [x] 1.3 Reject aliases, git, file, URL, and custom-registry specifiers, native/build/install-script trees, bad symlinks and entrypoints, and missing integrity, verified by hostile dependency-spec fixtures failing before activation.

## 2. Lifecycle and persistence

- [x] 2.1 Implement installed, disabled, incompatible, failed, quarantined, and pending states with reference-aware enable/disable/remove, side-by-side update, drain and restart, retained known-good rollback, and namespaced data snapshots, verified by lifecycle state tests.
- [x] 2.2 Block cascading project, profile, secret, and external-resource deletion, verified by removal tests asserting the referenced resources survive.
- [x] 2.3 Add safe diagnostics, audit, support-bundle, and backup/recovery coverage, verified by diagnostics tests asserting no secret material is emitted.

## 3. Official catalogue and release inputs

- [x] 3.1 Define hardcoded official SSH/Puzed catalogue records, resolve their exact npmjs versions and integrity through the ordinary preview/install path, and show an actionable offline or registry-unavailable state, verified by catalogue resolution tests.
- [x] 3.2 Verify signatures, provenance, and audit results as informational metadata and render the trusted-code warning for custom packages, verified by review-surface tests.
- [x] 3.3 Add deterministic artifact, SBOM, license, and integrity checks, verified by the release artifact checks.

## 4. Acceptance

- [x] 4.1 Verify a failed or interrupted install or update never changes the active version.
- [x] 4.2 Verify scripts and native builds never run and hostile dependency specs fail pre-activation.
- [x] 4.3 Verify rollback selects an exact retained slot without reverting external actions.
- [x] 4.4 Verify non-managers cannot mutate extensions and that browser and Desktop hosts store no package.
