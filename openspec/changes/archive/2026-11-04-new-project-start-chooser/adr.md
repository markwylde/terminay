# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (for Mark Wylde)
- Change: new-project-start-chooser

## In-Force ADR Context Reviewed

- openspec/adr/0002-sqlite-state-repository.md - still describes SQLite, but the workspace backend is a JSON file; the schema 6 → 7 migration is written against the backend in use. Not revisited.
- openspec/adr/0011-security-trust-boundary-model.md - the root folder browser is the first filesystem query not contained by a project root; ADR-0066 bounds it.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - start choice, recents, and browsing all run on the project's owning server.
- openspec/adr/0020-per-operation-canonical-roots.md - start-choice folders and browse paths are canonicalized per request, never cached.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md and openspec/adr/0028-no-polling-without-owner-approval.md - a no-root project runs no watch or Git query; recent-folder availability is checked on demand, not polled.
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - the browse query is not an MCP surface.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md and openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - the new behaviour is gated by a negotiated capability; browse authority is the device's.
- openspec/adr/0053-in-page-windows-share-one-modal-frame.md - the folder browser presents through the shared modal frame.
- openspec/adr/0059-a-workspace-change-reaches-every-layer-as-the-change.md - `project.start` and `recent.forget` publish as ordinary workspace deltas.
- Remaining in-force ADRs (0003, 0005, 0006, 0010, 0012, 0013, 0015, 0016, 0019, 0023, 0025-0027, 0029, 0033-0046, 0049-0052, 0054-0058, 0060-0062) reviewed; not touched by this change.

## Repository-Level ADRs Created

- openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md - a project root is chosen through one server-side browser in every host; it returns directory names only, requires root-change authority, is unreachable from MCP, and revalidates per request.

## Notes

- No existing ADR is superseded.
- The owner chose the server-side browser over the native macOS dialog so that one browser works for remote and phone clients.
- `openspec/adr/README.md` gains an index row for 0066.
