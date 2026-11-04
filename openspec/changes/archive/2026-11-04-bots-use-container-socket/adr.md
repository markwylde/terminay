# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-02
- Reviewer: Codex, for the owner's requested socket implementation
- Change: bots-use-container-socket

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - privileged engine authority.
- openspec/adr/0028-no-polling-without-owner-approval.md - event streams, no engine polling.
- openspec/adr/0047-a-window-is-one-server-running-the-host-bundle.md - server-owned service boundary.
- openspec/adr/0048-a-connection-belongs-to-a-window-and-authority-to-a-device.md - stream authority.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md - agent exceptions stay scoped.
- openspec/adr/0067-chat-providers-may-run-agents-as-an-owner-approved-exception.md - bots do not broaden chat authority.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - pin persistence.
- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - engine transport superseded, remaining bot decisions reaffirmed.
- openspec/adr/0091-bots-sign-in-with-their-own-credential.md - bot-owned sign-in only.

## Repository-Level ADRs Created

- openspec/adr/0092-bots-use-the-local-docker-compatible-socket.md - shared local socket transport and persistent engine identity.

## Notes

The ADR corpus and supersession graph were reviewed. No accepted ADR is edited. The owner selected the established repository ADR style and explicitly authorized proposal and implementation together in one branch/PR.
