# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-17
- Reviewer: Mark Wylde
- Change: mcp-drives-the-agents-view

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer replies stay untrusted data; the relay adds no authority path.
- openspec/adr/0039-app-views-are-mirrored-from-the-controlling-client.md - the addressed-event-plus-command pattern the relay reuses.
- openspec/adr/0040-home-tabs-are-device-local-presentation-in-their-own-dockview.md - view state stays device-local; Home tabs are not addressed.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - the target is a connection of one window; authority stays with the capability.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - folders are placement targets, never scope.
- openspec/adr/0068-mcp-authority-belongs-to-a-terminal-or-a-chat.md - every new tool has a fixed permission group; chats can use view tools.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md - the automation space stays reserved and never becomes a project tab; its terminals are now listed in Tabs.
- openspec/adr/0035-detached-session-holder-owns-ptys.md - restart recovery now places unnamed running shells instead of ending them.

## Repository-Level ADRs Created

- openspec/adr/0070-an-agents-view-operations-are-applied-by-the-client-it-is-talking-from.md - view operations go to the agent's own client over an addressed relay, and fail rather than pretend when none is reachable.
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md - every running terminal has a project and panel, unnamed shells found on restart are recovered, and Tabs lists terminals outside the window's projects.

## Notes

The relay is a request/reply built from existing primitives: transient
addressed events and commands. It does not extend the protocol frame set.
