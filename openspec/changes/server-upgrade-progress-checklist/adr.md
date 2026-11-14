# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-14
- Reviewer: Claude (Opus 5.5)
- Change: server-upgrade-progress-checklist

## In-Force ADR Context Reviewed

- openspec/adr/0062-a-server-upgrades-itself-to-its-own-channels-newest-signed-release.md - the server decides and publishes; the client only asks and reads status. The checklist reads that status and asks for nothing new.
- openspec/adr/0028-no-polling-without-owner-approval.md - the steps move on the status subscription, connection-phase changes and the one existing return deadline; nothing polls.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the card lives in the server-bundled renderer shell; hosts and the protocol are unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - no new privileged capability; renderer state only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- Deriving the steps on the client and moving the upgrade board to the window shell are tactical choices recorded in design.md; a later server-published phase field would not contradict them.
