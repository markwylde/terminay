# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-02
- Reviewer: Claude (for Mark Wylde)
- Change: notifications-icon-and-project-dot

## In-Force ADR Context Reviewed

The supersession graph was built from every file in `openspec/adr/`. ADR-0001, 0007, 0008, 0009, 0010, 0014, 0022, 0024, and 0030 are superseded and were treated as history only. Of the in-force set, these bear on this change:

- openspec/adr/0011-security-trust-boundary-model.md - renderer code holds no privileged authority; dismissal stays a server-owned acknowledgement issued through the existing client.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - each notification is acknowledged on the server that owns its terminal.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the header aggregates across attached connections and routes each action to its own connection.
- openspec/adr/0028-no-polling-without-owner-approval.md - the always-visible control introduces no timer or poll; it renders from the published inventory.
- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md - end-to-end coverage runs through `npm run test:e2e`.

The remaining in-force ADRs (0002-0006, 0012, 0013, 0015, 0016, 0019-0021, 0023, 0025-0027, 0029, 0031, 0033) concern storage, runtime, distribution, exposure, extensions, and MCP and are not touched.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change is presentational plus one new trigger for an existing acknowledgement operation. It adds no protocol surface, persistence, or boundary.
