# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-01
- Reviewer: Claude (Opus 5.5), for Mark Wylde
- Change: add-terminay-bots

## In-Force ADR Context Reviewed

- openspec/adr/0003-vault-interface-and-key-protectors.md - Claude Code tokens are kept in the server vault and released through `withSecret`.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - bots run on the server that owns them, wherever it runs.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - bot agents do not depend on session detection.
- openspec/adr/0028-no-polling-without-owner-approval.md - no poll is introduced:
  - Docker state comes from `docker events`.
  - Availability is checked on demand.
  - Idle stop is a one-shot deadline.
  - File and memory updates come from inotify.
  - CPU, memory, and disk figures are read on demand. `docker stats` streaming is not used, because it samples.
- openspec/adr/0030-automations-run-in-a-server-owned-space-with-workspace-scoped-mcp.md - bot triggers reuse the scheduler and event sources, but run as bot sessions without MCP.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - bots need an exception, which ADR-0089 records.
- openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md - left in force for chat providers. Its point 4 requires ADR-0089. Its objection to bundling ACP adapters does not apply to locally built images.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md - bots get no MCP reach.
- openspec/adr/0080-extension-installer-is-built-from-npm-libraries.md - bot agent install steps are pinned npm specifiers, consistent with the installer's npm model.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - every bot file is written with the durable-replace primitive: the bot store, each session's `session.json`, and its transcript segments. A segment that the metadata does not count is set aside as corrupt, never deleted. Nothing is appended to in place.

## Repository-Level ADRs Created

- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - an owner-approved exception: Terminay launches and prompts bot agents only inside their own container, as the ACP client, from extension-described agents and a locally built image.
- openspec/adr/0090-bots-share-only-the-hosts-auth-file-or-use-a-token.md - each bot signs in either through the host's login or with a token. Host login shares only the host's own auth file: its directory is mounted with every other entry masked, a tamper watch guards it, and the host file is never modified. Tokens are kept in the vault and injected through the docker client's environment, never its arguments. There is no model proxy.
- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - supersedes ADR-0090. Every bot signs in with its own credential: a Claude sign-in token, an Anthropic or OpenAI API key, or a device sign-in (Codex's Sign in with ChatGPT) that runs inside the bot's container and saves the login in its home. Terminay never reads, detects, or shares a login of the server account.

## Notes

- ADR-0089 and ADR-0090 were revised after two Codex reviews, before either was merged. Neither had been accepted into history. ADR-0090 was renamed to match its new decision.

- ADR-0091 supersedes ADR-0090, after the owner tried host login and removed it. ADR-0067 still governs chat providers.
- Sharing the engine socket is a per-bot, opt-in product setting with a warning. It is recorded in the specs and in ADR-0089's consequences, not in an ADR of its own.
