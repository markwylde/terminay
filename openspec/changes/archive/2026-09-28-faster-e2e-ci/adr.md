# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-28
- Reviewer: Claude (with Mark Wylde)
- Change: faster-e2e-ci

## In-Force ADR Context Reviewed

- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - Defines pull-request CI's shape and E2E image transfer. The shape is kept; the transfer and image structure change, so it is superseded.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - This change was driven by measured stage timings from CI logs and the Gitea API, and it adds per-test timing so later work is measured too.
- openspec/adr/0028-no-polling-without-owner-approval.md - No polling is introduced. The global setup waits on one request for the committed bundle.
- Remaining in-force ADRs (0001-0009, 0011-0020, 0022-0027, 0029-0031) - Not relevant to CI image distribution or test sharding.

## Repository-Level ADRs Created

- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md - Pull-request E2E runs on a lockfile-keyed dependency base image, distributed through the internal registry and extended per commit, with the suite sharded by test. It supersedes ADR-0010 and restates the parts of ADR-0010 that remain in force.

## Notes

ADR-0010 is left unedited, as the ADR rules require.
