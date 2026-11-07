# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-07
- Reviewer: Claude (for Mark Wylde)
- Change: fast-pwa-resume

## In-Force ADR Context Reviewed

Depth of review: ADRs 0001 to 0101 were screened by title. Those touching remote transport, liveness, diagnostics and settings authority were checked against this change.

- Remote transport and liveness ADRs: the heartbeat is still the only liveness proof and traffic is still never inferred from. This change adds a shorter, decisive probe at the one moment the document is known to have been suspended.
- ADR-0088 (durable state files): the timing store is rebuildable diagnostics. A corrupt line is skipped and the file is never treated as canonical state.
- Screened by title and not engaged: every other ADR from 0001 to 0101.

## Repository-Level ADRs Created

- None. The resume probe tightens one deadline in the existing liveness model. The timing store is a bounded diagnostics file behind a setting, inside the existing metadata-only diagnostics boundary.

## Notes

The highest ADR sequence number in use is 0101.
