# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-27
- Reviewer: Claude (Opus 5.5)
- Change: fix-agy-fractional-turn-end

## In-Force ADR Context Reviewed

- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md - sessions come from all-your-agents through the built-in extension; the adapter is where library data is normalised before it crosses to the host.
- openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md - context for the extension runtime; not affected.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The fix is a tactical normalisation inside the existing adapter. Host validation and the Extension API contract are unchanged.
