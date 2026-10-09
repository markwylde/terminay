# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Claude (for Mark Wylde)
- Change: fix-folder-card-deleting-state

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0055 was screened by its title only. The notes below say what each engaged title asks of this change; none was read in full, and the supersession graph was not rebuilt from the `Supersedes` fields.

- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays untrusted. It draws state it already holds and gains no command.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - the deleting line is presentation only. No authority is derived from it.
- openspec/adr/0028-no-polling-without-owner-approval.md - nothing is polled; the line follows the removal this device started.
- Screened by title and not engaged: every other ADR from 0001 to 0055.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. One renderer surface draws a state the workspace already tracks; server state, the protocol, and persistence are unchanged.

## Notes

The highest ADR sequence number in use is 0055.
