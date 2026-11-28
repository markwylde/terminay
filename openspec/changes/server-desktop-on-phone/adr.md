# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-28
- Reviewer: Claude (for Mark Wylde)
- Change: server-desktop-on-phone

## In-Force ADR Context Reviewed

Depth of review: the supersession graph was rebuilt from the `Supersedes` field of every ADR file in `openspec/adr/`. Fifty-three files carry the field and between them name fifty-one earlier ADRs, wholly or in part. None of them names ADR-0125, 0145, 0146, or 0147, so all four are in force as written. ADR-0125 was read; the other three were checked against this change by title and by the parts of `add-server-desktop`'s design that cite them. The remaining ADRs were screened by title only and their bodies were not re-read.

- openspec/adr/0125-compact-drawers-and-sheets-are-navigation-surfaces.md - in force (supersedes ADR-0053 in part). The Show Desktop row is a navigation row inside the existing drawer, and Close tab is an entry in an existing menu; no new surface is added.
- openspec/adr/0145-the-server-desktop-is-one-whole-screen-display-terminay-owns-reachable-only-through-a-private-socket.md - in force; unchanged by this change.
- openspec/adr/0146-the-server-desktop-is-a-server-wide-trust-domain-with-one-controlling-client.md - in force; the row adds no authority and the server still checks each operation.
- openspec/adr/0147-bot-and-server-desktops-share-one-remote-desktop-package-and-differ-only-in-connector-and-authority.md - in force; the shared viewer package is not touched.
- Screened by title and not engaged: every other ADR from 0001 to 0150.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The highest ADR sequence number in use is 0150. The change adds a renderer entry point, a menu entry, and an inventory kind; it crosses no host, server, or security boundary.
