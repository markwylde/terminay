# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-11
- Reviewer: Claude
- Change: recording-replay-fidelity

## In-Force ADR Context Reviewed

- No ADR governs recordings directly. Reviewed the recording capability spec's server-ownership and canonical-client requirements, which this change keeps: capture stays in Terminay Server, and renderers use `RecordingsClient`.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Bug fixes to an existing capability: replay uses the protocol's existing binary query result, and the recorder observes an existing terminal-service hook.
