# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-16
- Reviewer: Claude (for Mark Wylde)
- Change: bot-composer-grows-with-text

## In-Force ADR Context Reviewed

Depth of review: every ADR from 0001 to 0131 was listed and its `Status` and `Supersedes` fields read to build the supersession graph; the in-force set was then screened by title and scope. No body was re-read in full, because none constrains renderer layout.

- Superseded and not in force (historical context only): every ADR named in a later ADR's `Supersedes` field, e.g. ADR-0001, ADR-0004, ADR-0007, ADR-0008, ADR-0009, ADR-0014, ADR-0018, ADR-0022, ADR-0024, ADR-0032, ADR-0035, ADR-0073, ADR-0089, and the parts of ADR-0016, ADR-0027, ADR-0072 and ADR-0093 that later ADRs name.
- In force and not engaged: every other ADR from 0001 to 0131. They govern hosts, server ownership, protocol, security boundaries, bots' runtime, releases and persistence. The change sizes one renderer textarea inside a Home tab, adds no stored state or protocol message, and crosses no host, server, or security boundary.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The highest ADR sequence number in use is 0131.
