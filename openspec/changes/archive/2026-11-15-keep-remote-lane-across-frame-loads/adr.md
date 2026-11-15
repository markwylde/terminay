# ADR Review Manifest

## ADR Review Completed

- Date: 2026-11-15
- Reviewer: Claude
- Change: keep-remote-lane-across-frame-loads

## In-Force ADR Context Reviewed

- No in-force ADR decides how Desktop detects a document reload or what the
  standalone server logs per connection. The change follows the existing
  Local binding's main-frame rule and the existing hosted diagnostic format.

## Repository-Level ADRs Created

- None: this corrects reload detection to match the behaviour the spec
  already required, and extends existing diagnostics without a new durable
  architectural decision.

## Notes

The fix is entirely in Desktop. A server upgrade adds only the logging.
