# ADR Review Manifest

## ADR Review Completed
- Date: 2026-11-02
- Reviewer: Codex, for the owner's proxy request
- Change: bots-proxy-engine-socket

## In-Force ADR Context Reviewed
- openspec/adr/0011-security-trust-boundary-model.md - accurate authority boundaries.
- openspec/adr/0028-no-polling-without-owner-approval.md - event-driven lifecycle and bounded deadlines.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - server-owned engine selection and client contracts.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - no new renderer engine authority.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - saved environment settings.
- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - bot lifecycle and former opt-in/socket policy.
- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - preserve bot-owned credentials.
- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - pinned local socket and daemon-side mount path.
- openspec/adr/0093-bots-communicate-through-a-durable-message-log.md - independent agent sessions and runtime authority.

## Repository-Level ADRs Created
- openspec/adr/0094-bots-attribute-engine-workloads-through-per-bot-proxies.md - default per-bot attribution proxies with unrestricted engine control.

## Notes
The 93-file ADR inventory and supersession fields were reviewed. No accepted ADR was edited. The owner authorizes all work in the existing branch/PR and previously selected the established custom ADR style.
