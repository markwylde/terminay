# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-22
- Reviewer: Claude (Opus 5.5), for Mark Wylde
- Change: folders-pane-strip-and-agent-launchers

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - client input is untrusted at the create boundary; the launcher id is resolved on the server.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - forbids starting an agent without an owner-approved exception; this change needs one.
- openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md - approves chat providers only and requires a separate ADR for any other launch.
- openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md - the typed executable path is ordinary terminal input and carries no secret.
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md - a launched terminal is created in a folder like any other and shown there.

## Repository-Level ADRs Created

- openspec/adr/0073-a-users-click-may-start-an-installed-agent-in-a-new-terminal.md - owner-approved exception to ADR-0051: a user's click may start an installed agent, bare, in a new default-profile terminal, with the command resolved on the server.

## Notes

- The tree's restyle is presentation only and needs no ADR. It keeps the reorder behaviour of the unarchived `reorder-any-folder` and `left-column-tabs` changes.
