# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude (with Mark Wylde)
- Change: standalone-server-hosts-terminay-mcp

## In-Force ADR Context Reviewed

- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - every server owns MCP for its projects; this change makes the standalone server honour it
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - MCP authority is reach plus the user's policy; approvals become unconditional
- openspec/adr/0074-a-terminals-mcp-capability-follows-it-between-projects-and-never-widens.md - project moves keep revoking approvals and never widen reach after the move into the shared host
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - capability digest persistence keeps its order and corrupt-file behaviour
- openspec/adr/0037-mcp-apps-reach-terminals-through-a-terminay-gateway.md - the connected-server gateway moves into the shared host
- openspec/adr/0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md - socket placement rules apply unchanged to the standalone server
- openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md - workspace view behaviour unchanged, now on every server
- openspec/adr/0076-app-window-records-are-server-data-that-last-as-long-as-their-session.md - standalone server keeps window records in its data root
- openspec/adr/0100-a-bot-may-hold-workspace-mcp-reach-when-its-owner-opts-it-in.md and openspec/adr/0102-an-opted-in-bot-has-pixels-full-terminay-control.md - bot capability minting moves into the shared host

## Repository-Level ADRs Created

- openspec/adr/0108-every-server-host-composes-one-mcp-host-with-no-opt-outs.md - one shared MCP host module; approvals, app windows and workspace view are always composed; the user setting is the only switch

## Notes

- The ADR index in openspec/adr/README.md gains a row for 0108.
