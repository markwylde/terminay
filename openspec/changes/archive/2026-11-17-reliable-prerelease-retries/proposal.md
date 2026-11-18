## Why

Canary desktop updates stop publishing when a failed job is retried after a stable release is tagged. The first failing run also exits while preparing the Windows update-test installer, preventing validation and publication.

## What Changes

- Preserve the release base tag selected by the version planner through desktop retries.
- Verify Windows update-test packaging on a native runner and preserve stage/exit diagnostics without weakening installation or update verification.
- Add regression coverage and preserve useful build failure diagnostics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: a release attempt retains its planned version inputs through job retries, and Windows update-test packaging reports its failed stage.

## Impact

Prerelease version script, rolling release workflow, Windows update-test builder, release regression tests. Signing, publication gates and renderer/server authority remain unchanged.
