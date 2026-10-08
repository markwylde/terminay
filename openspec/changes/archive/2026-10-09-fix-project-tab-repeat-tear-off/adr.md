# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Claude (for Mark Wylde)
- Change: fix-project-tab-repeat-tear-off

## In-Force ADR Context Reviewed

Titles of all ADRs 0001–0046 were listed; the ones below bear on this change. The rest concern unrelated subsystems and were not read in full.

- openspec/adr/0011-security-trust-boundary-model.md - the renderer→host action bridge is a privilege boundary; this change leaves the `workspace.drag.start` validator unchanged and makes the caller conform.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - tab order and window composition are client-owned presentation; drag state stays presentation-local.
- openspec/adr/0028-no-polling-without-owner-approval.md - the cursor poll during a drag already exists and is bounded by the drag; this change adds no polling.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - Home is not a project tab and takes no part in project drag; unaffected.
- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md and openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md - the added end-to-end tests run inside the existing sharded container suite.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The fix restores an existing contract (a torn-off announcement is retracted when its drag ends) rather than establishing a new one.
