## Why

Developers wait 8–20 minutes for complete CI feedback. Reduce the measured execution critical path below five minutes, excluding runner queueing while retaining every required test and packaged-artifact boundary.

The owner accepted a qualifying 288-second execution path and disclosed latest variation of 391 seconds, and requested wrap-up. The target is measured and reported; it is not a claim that every run stays below 300 seconds. Original creation-to-green elapsed evidence remains unchanged.

## What Changes

- Repair E2E test selection and balance shards using measured durations, with explicit coverage validation.
- Remove repeated Linux builds and share revision-matched artifacts without weakening platform checks.
- Parallelize independent workspace suites and reduce expensive test-fixture preparation.
- Prioritize critical-path scheduling and diagnose runner availability.
- Report queue-excluded execution critical path alongside original creation-to-green elapsed time, attempts and runner waits so regressions remain visible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pull-request-ci`: duration-balanced coverage, measured queue-excluded execution readiness, and reusable verified build outputs.

## Impact

Gitea workflow, build/test scripts, E2E selection and fixtures, CI timing evidence and runner operations. Keep the implementation and planning in one Terminay worktree and PR. Dedicated runners and infrastructure provisioning are outside scope; infrastructure PR 49 was closed without deployment. Preserve Electron Docker isolation, native ABI floor and existing security checks.
