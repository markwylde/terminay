## Why

Server artifacts did not package npm, no extension store, receipt, or registry existed, and
there was no administrator install, preview, update, rollback, or remove lifecycle.

## What Changes

- Package a pinned npm installer with Desktop-embedded, standalone x64/arm64, and Docker
  servers without introducing a system npm or compiler dependency.
- Build a sterile npmjs-only resolve/preview/confirm pipeline with exact lock and integrity,
  scripts-disabled staging, bounded tree validation, immutable slots, receipts, atomic
  activation, crash recovery, and cleanup.
- Reject aliases, git, file, URL, and custom-registry specifiers, native/build/install-script
  trees, bad symlinks and entrypoints, and missing integrity.
- Implement installed, disabled, incompatible, failed, quarantined, and pending states with
  reference-aware enable, disable, and remove; side-by-side update; drain and restart; retained
  known-good rollback; and namespaced data snapshots.
- Block cascading project, profile, secret, and external-resource deletion.
- Add safe diagnostics, audit, support-bundle, and backup/recovery coverage.
- Define hardcoded official SSH and Puzed catalogue records resolved through the ordinary
  preview/install path, with an actionable offline or registry-unavailable state.
- Report signature, provenance, and audit results as informational metadata and show the
  trusted-code warning for custom packages.
- Add deterministic artifact, SBOM, license, and integrity checks.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `extension-platform`: adds the sterile installer, transactional installation pipeline,
  lifecycle states, side-by-side updates, rollback slots, retention rules, and the official
  catalogue resolution path.

## Impact

Server artifact packaging for Desktop-embedded, standalone x64/arm64, and Docker builds; the
extension store, receipt, and registry on the server data root; the administrator extension
management surface; release artifact, SBOM, license, and integrity checks.
