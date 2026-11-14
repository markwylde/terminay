## Why

Developers wait 8–20 minutes for complete CI feedback. Restore a measured creation-to-green budget below five minutes while retaining every required test and packaged-artifact boundary.

## What Changes

- Repair E2E test selection and balance shards using measured durations, with explicit coverage validation.
- Remove repeated Linux builds and share revision-matched artifacts without weakening platform checks.
- Parallelize independent workspace suites and reduce expensive test-fixture preparation.
- Prioritize critical-path scheduling and diagnose runner availability.
- Report end-to-end elapsed time, attempts, queueing and execution so regressions remain visible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pull-request-ci`: duration-balanced coverage, measured creation-to-green readiness, and reusable verified build outputs.

## Impact

Gitea workflow, build/test scripts, E2E selection and fixtures, CI timing evidence and runner operations. One worktree and PR; preserve Electron Docker isolation, native ABI floor and existing security checks.
