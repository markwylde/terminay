# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-28
- Reviewer: Claude
- Change: keep-ready-bot-image-notice-dismissed

## In-Force ADR Context Reviewed

- openspec/adr/0012-pwa-framed-session-host.md - why storage in a framed iOS session is unreliable.
- openspec/adr/0028-no-polling-without-owner-approval.md - clients update from the existing change event; the resend is event driven.
- openspec/adr/0088-terminay-state-files-are-replaced-durably-and-recovered-by-kind.md - the list lives in the existing `bot-builds` record.
- openspec/adr/0104-a-notification-is-acknowledged-only-by-what-the-user-does.md - concerns notification records; this notice keeps its own dismiss and seen-and-left rules.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The server owning one notice's acknowledgement is scoped to this notice and sets
no repository-wide pattern.
