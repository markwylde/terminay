## Why

The feature-contract cleanup moved implementation status and old checklists out of the
canonical specifications, but code inspection still found concrete gaps in large-file
interaction, recording scalability, MCP verification, and one stale WebRTC fallback
message. These predate the server/client architecture work and would otherwise become
hidden assumptions during service extraction.

## What Changes

- Implement the large-file text, diff, and HEX interaction slice: virtualized unified and
  side-by-side diff rows, selection, one shared Text/HEX draft, explicit Performant-to-Monaco
  transitions, bounded incremental indexing, and privileged structured-diff normalization.
- Implement bounded recording replay, opaque-id recording actions, active-recording reveal,
  and one shared privileged input-capture boundary.
- Replace the historical unchecked manual-test statement for MCP with reproducible automated
  coverage plus a documented limitation.
- Replace the obsolete WebRTC "scaffolded/peer handler unavailable" message with an accurate
  recoverable-state explanation when a configured host cannot become ready.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `file-viewer`: bounded large-file text/diff/hex interaction and privileged diff normalization.
- `recording`: bounded replay, opaque-id actions, and one privileged input boundary.
- `mcp-server`: reproducible provider-format, official-SDK stdio, and live multi-project coverage.
- `remote-access`: accurate configured-host failure states in place of the scaffold message.

## Impact

File viewer renderer and privileged Git/diff normalization, recording service and replay,
MCP stdio adapter and provider installation, WebRTC service runtime status reporting.
Deliberately does not complete the file, recording, or MCP service extractions.
