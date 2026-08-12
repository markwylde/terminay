# Extension installation and management

## Goal

Install exact official or custom npmjs extensions transactionally under the
selected server data root with scripts disabled, safe updates, and rollback.

## Delivery phase

Phase 2, in parallel with [Tasks 43](./43-environment-routed-project-services.md),
[45](./45-project-environment-and-extension-ui.md), and
[47](./47-official-puzed-extension-foundation.md).

## Dependency

- [Task 42](./42-extension-api-manifest-and-host.md)

## Governing specifications

- [Server extension platform](../features/extension-platform.md)
- [Extension operations](../operations/extensions.md)

## Current gap

Server artifacts do not package npm, no extension store/receipt/registry exists,
and there is no admin install/preview/update/rollback/remove lifecycle.

## Parallel work streams

### Installer and store

- [ ] Package pinned npm 11.9 with Desktop-embedded, standalone x64/arm64, and
  Docker servers without introducing a system npm/compiler dependency.
- [ ] Build sterile npmjs-only resolve/preview/confirm, exact lock/integrity,
  scripts-disabled staging, bounded tree validation, immutable slots, receipts,
  atomic activation, crash recovery, and cleanup.
- [ ] Reject aliases/git/file/URL/custom registry, native/build/install-script
  trees, bad symlinks/entrypoints, and missing integrity.

### Lifecycle and persistence

- [ ] Implement installed/disabled/incompatible/failed/quarantined/pending states,
  reference-aware enable/disable/remove, side-by-side update, drain/restart,
  retained known-good rollback, and namespaced data snapshots.
- [ ] Block cascading project/profile/secret/external-resource deletion.
- [ ] Add safe diagnostics, audit, support-bundle and backup/recovery coverage.

### Official catalogue/release inputs

- [ ] Define hardcoded official SSH/Puzed catalogue records, resolve their exact
  npmjs versions/integrity through the ordinary preview/install path, and show
  an actionable offline/registry-unavailable state.
- [ ] Verify signatures/provenance/audit as informational metadata and render
  the trusted-code warning for custom packages.
- [ ] Add deterministic artifact/SBOM/license/integrity checks.

## Acceptance checks

- Failed/interrupted install or update never changes the active version.
- Scripts/native builds never run; hostile dependency specs fail pre-activation.
- Rollback selects an exact retained slot without reverting external actions.
- Non-managers cannot mutate extensions and browser/Desktop store no package.

## Definition of done

Every supported server installs, updates, rolls back, disables, and removes
extensions through one recoverable audited contract without system npm.
