# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-11
- Reviewer: Claude (for Mark Wylde)
- Change: second-agent-in-a-terminal-is-heard

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0061 was screened by its title only; none was re-read for this change, and the supersession graph was not rebuilt from the `Supersedes` fields.

- openspec/adr/0061-a-notification-is-a-server-owned-record-published-after-a-settle-period.md - notifications are raised from terminal activity; this change repairs the activity they are raised from and changes nothing about how they are held or published.
- Screened by title and not engaged: every other ADR from 0001 to 0061.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. One guard in the activity reducer learns that a finished agent no longer holds its terminal.

## Notes

The highest ADR sequence number in use is 0061.
