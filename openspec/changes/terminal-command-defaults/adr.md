# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-30
- Reviewer: Claude (Opus 5.5), for Mark Wylde
- Change: terminal-command-defaults

## In-Force ADR Context Reviewed

- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - forbids adding flags to an agent without an owner-approved exception; this change needs one, scoped to registered command defaults.
- openspec/adr/0073-a-users-click-may-start-an-installed-agent-in-a-new-terminal.md - launchers start agents bare; superseded so a launcher may type a registered default's flags, with every other launcher rule carried forward.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - detection still comes from all-your-agents; the binding rule narrows what binds and adds no detection of its own.
- openspec/adr/0011-security-trust-boundary-model.md - clients send only a launcher id; extensions send only validated data; integration scripts are fixed server files.
- openspec/adr/0057-nothing-written-into-a-terminal-is-a-secret.md - the typed path and flags are ordinary terminal input and carry no secret.
- openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md - unaffected; chat providers keep their own launch rules.
- openspec/adr/0071-a-running-terminal-always-has-a-place-someone-can-see.md - unaffected; integration changes how a shell starts, not where a terminal lives.

## Repository-Level ADRs Created

- openspec/adr/0081-a-registered-command-default-may-add-flags-to-an-agent-started-in-a-terminay-terminal.md - owner-approved exception to ADR-0051, superseding ADR-0073: a registered command default may add flags to a command typed or launched in a Terminay terminal. The first and only approved default is `codex` → `--no-daemon`.
- openspec/adr/0082-shell-integration-is-a-server-managed-launch-layer-fed-only-by-data.md - shell integration is a server-managed launch layer for zsh, bash, fish, and PowerShell that runs the user's startup files first, never writes them, and accepts only data from extensions.

## Notes

- ADR-0051 stays in force. ADR-0081 narrows it for flags registered through command defaults only.
- The `extension-platform` delta modifies `Contribution arrays` and `Bounded API scope`, which the unarchived `folders-pane-strip-and-agent-launchers` and `add-agent-chat-and-pixel` changes also modify. This change's text includes their arrays; whichever archives last must keep the full list.
