# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (with Mark Wylde)
- Change: ci-under-five-minutes

## In-Force ADR Context Reviewed

- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md - Fixes the CI shape at one fast gate and ten shards, and defines the layered registry images. The images are kept; the gate and the shard count change, so it is superseded.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md - Every job still installs npm 12.2.0 on Node 24.15.0. Only where npm keeps its download cache changes.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - The change is driven by per-job and per-step timings read from the Gitea API and job logs, not by estimates.
- openspec/adr/0028-no-polling-without-owner-approval.md - No polling is introduced.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md and 0034-no-media-relay-reachability-from-candidates-and-routing-hints.md - The container image smoke still proves the same four cases, including the control that shows the isolated networks isolate.
- Remaining in-force ADRs (0002, 0003, 0005, 0006, 0011-0013, 0015, 0017-0020, 0023, 0025-0027, 0029, 0031, 0035) - Not relevant to how CI schedules its jobs.

## Repository-Level ADRs Created

- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-fourteen-shards.md - CI has a five-minute budget, met by running independent work in separate jobs, fourteen E2E shards, and a runner-held npm cache. It supersedes ADR-0032 and restates the parts of ADR-0032 that remain in force.

## Notes

ADR-0032 and ADR-0010 are left unedited, as the ADR rules require. `scripts/provider-portable-ci.test.mjs` still reads ADR-0010 for the decisions it records about the macOS runner and release evidence.
