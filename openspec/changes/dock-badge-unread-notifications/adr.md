# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (for Mark Wylde)
- Change: dock-badge-unread-notifications

## In-Force ADR Context Reviewed

The supersession graph was built from the `Supersedes` field of every file in `openspec/adr/`. ADR-0001, 0004, 0007, 0008, 0009, 0010, 0014, 0022, 0024, and 0030 are superseded and were treated as history only. Of the in-force set, these bear on this change:

- openspec/adr/0011-security-trust-boundary-model.md - the renderer gains one validated, window-attributed host action carrying a single bounded integer and no other authority.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the host stays protocol-blind: it sums numbers reported by windows and never reads server activity.
- openspec/adr/0028-no-polling-without-owner-approval.md - the badge updates on count change and window close; no timer or poll is added.
- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md - end-to-end coverage runs through `npm run test:e2e`.

The remaining in-force ADRs (0002, 0003, 0005, 0006, 0012, 0013, 0015-0017, 0019-0021, 0023, 0025-0027, 0029, 0031, 0033-0035) concern storage, runtime, distribution, exposure, extensions, MCP, and session ownership and are not touched.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change adds one closed host action within the existing host-action contract and a call to a platform API. It introduces no pattern, boundary, or dependency that later changes must honour.
