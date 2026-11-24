# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-13
- Reviewer: Claude (with Mark Wylde)
- Change: server-import-export

## In-Force ADR Context Reviewed

- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - the window holds per-connection clients, and compatibility is negotiated per connection (supersedes 0018 and 0008).
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - each write uses the authority of its own connection.
- openspec/adr/0075-management-lives-in-one-settings-surface.md - Settings is the only management surface, scoping is explicit, and the first menu is Terminay. This change stays within it.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the bundle export goes through a bounded bridge action, never a path.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md - automations stay server-owned, and copies arrive disabled.
- openspec/adr/0097-workflows-are-checklists-an-agent-drives-and-terminay-never-runs-a-step.md - only templates are copied, never workflow instances.

## Repository-Level ADRs Created

- openspec/adr/0111-cross-server-copy-is-client-mediated-through-each-servers-own-client.md - copying between servers is done by the client, matched by name, revision-guarded, and one-time, from one Settings category that spans connections. Bundles contain no ids. It partly supersedes ADR-0075.

## Notes

- ADR-0111 supersedes ADR-0075 rules 2 and 4 for the Import & Export category only. ADR-0075's file is unchanged.
