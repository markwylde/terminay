# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-24
- Reviewer: Claude
- Change: bot-environment-fast-overview

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - no poll or timer is introduced; usage is read on Overview open and Refresh, and the Start panel follows the environment state the client already watches.
- openspec/adr/0089-bots-run-agents-in-their-own-container-over-acp.md - the container and its lifecycle are unchanged.
- openspec/adr/0120-bot-containers-run-under-a-terminay-apparmor-profile-that-allows-user-namespaces.md - the AppArmor decision still governs every container create; the Overview's state read only avoids waiting on an unsettled probe.
- openspec/adr/0127-a-bots-executions-share-its-shell-and-desktop.md - sharing between executions is unchanged; only the user's Shell view stops starting the container.
- openspec/adr/0131-an-idle-bot-takes-its-container-update-before-its-next-run.md - starting from the panel uses the same start path, so a stopped out-of-date container is still recreated on start.

Historical context only: ADR-0022 (watch, do not poll) is superseded by ADR-0028 and was not treated as in force.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

No accepted ADR is edited or superseded.
