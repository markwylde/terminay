# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-09
- Reviewer: Claude (for Mark Wylde)
- Change: rename-terminal-from-folders-row

## In-Force ADR Context Reviewed

Depth of review: every ADR was screened by its title only. The notes below say what each engaged title asks of this change; none was read in full.

- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays untrusted. It sends the panel title update the tab editor already sends and gains no command.
- openspec/adr/0049-a-folder-groups-panels-and-is-not-an-identity-boundary.md - a row is renamed by its panel id, whichever folder holds it.
- Screened by title and not engaged: every other ADR from 0001 to 0054.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It adds one renderer interaction over an existing server-owned update.

## Notes

The highest ADR sequence number in use is 0054.
