# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-28
- Reviewer: Claude (with Mark Wylde)
- Change: expose-on-startup-setting

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - Exposure stays an explicit administrator decision; the setting is that decision, default off, and pairing still requires host approval.
- Remaining in-force ADRs - Not affected: no transport, pairing, bundle or window-boundary changes.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The startup setting is captured in the remote-access requirement "Exposure is explicit and administrator-controlled".
