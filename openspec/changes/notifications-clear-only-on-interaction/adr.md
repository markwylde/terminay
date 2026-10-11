# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-11
- Reviewer: Claude (for Mark Wylde)
- Change: notifications-clear-only-on-interaction

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0061 was screened by its title only. The notes below say what each engaged title asks of this change; ADR-0061 was read in full when it was written, the rest were not, and the supersession graph was not rebuilt from the `Supersedes` fields.

- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - the server still owns every notification and its settle period, and removal is still the server-owned acknowledgement. This change narrows when a client sends one on its own account and lets it say that the user did nothing, so that what a process sent is kept.
- openspec/adr/0060-a-push-is-sealed-per-pairing-and-attributed-by-the-device.md - push reads the published set and is untouched; it now has something to send in the case this change repairs.
- Screened by title and not engaged: every other ADR from 0001 to 0061.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. A client-side shortcut is narrowed, the wire event that extended it is removed, and an acknowledgement gains an optional flag; what the server holds and how it is published are unchanged.

## Notes

The highest ADR sequence number in use is 0061.
