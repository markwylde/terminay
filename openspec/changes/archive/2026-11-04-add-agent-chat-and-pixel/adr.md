# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (with owner decisions from Mark Wylde)
- Change: add-agent-chat-and-pixel

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - control-socket row gains the chat-mint invariant
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - chat agents run on the owning server
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - terminal agents stay observed; chat sessions are not detected sessions
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md - precedent for extension-owned long-lived child processes
- openspec/adr/0028-no-polling-without-owner-approval.md - CLI lookup runs once per activation, never polled
- openspec/adr/0031-mcp-authority-is-scope-times-user-permission-policy.md - binds approvals and grants to a calling terminal; superseded by 0068
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - chats belong to a window's server; phones reach them through the server
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - chat operations need terminal-create authority
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - chat providers launching agents need a recorded owner exception (0067)
- openspec/adr/0058-a-fact-taken-from-terminal-output-is-live-server-state-and-never-a-workspace-commit.md - activity notes use Terminay's own titles, never terminal output; conversation is never persisted

## Repository-Level ADRs Created

- openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md - owner-approved exception to ADR-0051: chat providers may start the user's installed agent CLI with confining flags and session config, never writing agent files or prompting on their own
- openspec/adr/0068-mcp-authority-belongs-to-a-terminal-or-a-chat.md - supersedes ADR-0031: a capability belongs to a terminal or an agent chat; a chat's scope is its recorded reach; chat approvals render in the chat

## Notes

- ADR-0030 stays superseded; its surviving decisions are restated in 0068 as they were in 0031.
- The README index marks 0031 as superseded by 0068; no ADR file was edited.
