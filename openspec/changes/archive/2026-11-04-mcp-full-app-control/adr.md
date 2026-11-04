# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-20
- Reviewer: Claude (for Mark Wylde)
- Change: mcp-full-app-control

## In-Force ADR Context Reviewed

- openspec/adr/0068-mcp-authority-belongs-to-a-terminal-or-a-chat.md: decision 3 ("workspace scope widens reach, not powers") is superseded by ADR-0072. Its other decisions are carried forward unchanged.
- openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md: workspace-window presentation, `focus_home` and `create_project`'s showing of the project use the agent's client relay.
- openspec/adr/0066-choosing-a-project-root-browses-server-directory-names-under-root-change-authority.md: `create_project` takes an explicit path, and browsing stays unreachable through MCP.
- openspec/adr/0020-per-operation-canonical-roots.md: `create_project` and `update_project` canonicalise the root per operation.
- openspec/adr/0003-vault-interface-and-key-protectors.md and openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md: stored credentials stay outside every settings tool.
- openspec/adr/0043-a-terminal-changes-project-by-retiring-its-identity.md: `move_terminal_to_project` retires the terminal's old project identity; its MCP handle, a session id, stays the same.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md: MCP authority is not device authority, so the handlers use a server-internal principal.
- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md: listing and dismissal act on published notifications only.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md: `focus_home` changes only the agent's client's Home.
- openspec/adr/0011-security-trust-boundary-model.md: it gains the invariants that ADR-0072 lists.

## Repository-Level ADRs Created

- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md: reach (project or workspace) decides app-level authority. It is checked per operation before the policy. Workspace reach controls the app apart from a fixed excluded set. Settings are reachable through an allow-list. Supersedes ADR-0068.

## Notes

- `openspec/adr/README.md` indexes ADR-0072 and marks ADR-0068 as superseded. The ADR-0068 file is untouched.
