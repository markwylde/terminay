# MCP agent output ergonomics

## Goal

Give MCP agents bounded, honest terminal-output workflows: lossless raw PTY
output can be paged by a cursor, while text and ANSI describe an explicitly
current emulated presentation rather than pretending to be a byte-range
transcript.

## Governing specifications

- [MCP server](../features/mcp-server.md)

## Scope

- A shared server-owned raw replay-range reader used by both Desktop and the
  standalone-server MCP adapters.
- Bounded `raw`, `text`, and `ansi` `read_terminal` contracts, plus bounded
  snapshot-only `search_terminal`.
- A submission-only `run_command.command_id` and an unambiguous raw lower-bound
  cursor.
- Explicit adapter-global tool availability and required-common MCP response
  conformance.

Out of scope: correlating a submitted command with shell completion, exit
status, or precisely attributable output; incremental emulated-screen deltas;
and unbounded terminal-history search.

## Implementation slices

- [x] Add a server-core raw replay-range API that validates a source cursor,
  captures a terminal high-watermark, returns exact bounded bytes and retention
  metadata, and does not create an oversized replay subscription. Use it from
  both MCP adapters; remove Desktop's independent tail-buffer read path from
  MCP output reads.
- [x] Extend the canonical presentation authority with a bounded read of its
  current emulated state and geometry. Define visual-row extraction, wrapping,
  and safe ANSI serialization once; use it for Desktop and standalone MCP
  snapshot reads.
- [x] Extend dispatcher and stdio schemas for format-specific
  `read_terminal` inputs. Implement raw Base64 pagination and text/ANSI
  snapshot results exactly as specified, including response-safe 16 KiB
  defaults, 64 KiB public caps, complete-response measurement, and distinct
  history/pagination/presentation truncation signals.
- [x] Add `search_terminal` validation and bounded literal snapshot search.
  Enforce its case, context, match, scan, and response-size rules without
  allocating an unbounded row or result array.
- [x] Return `command_id`, `from`, `submitted_bytes`, and `submitted: true`
  from `run_command` in both adapters. Capture `from` before accepting the
  write; do not add unsupported command-to-exit correlation.
- [x] Add `get_mcp_capabilities` from the bound adapter and use it to state
  Desktop/standalone availability of optional wait operations before calls.
  Preserve stable `unsupported_op` failures for unavailable registered tools.
- [x] Define shared required-response schema fixtures. Test Desktop and
  standalone adapters against those fixtures while allowing documented host
  extensions. Add MCP stdio schema and complete-response-size tests.
- [x] Add server-core and adapter tests for binary/invalid UTF-8 raw output,
  stale and future cursors, pagination boundaries, history loss, resize and
  cursor-motion presentation, escaped bracketed paste, search bounds, and
  command submission metadata. Run Electron end-to-end coverage only through
  `npm run test:e2e`.

## Acceptance checks

- A raw read returns Base64 that decodes byte-for-byte to retained PTY output;
  successive calls with `after: next` cover a retained stream without overlap.
- A stale raw cursor reports `history_lost` and the current `replay_from`; a
  future cursor is rejected; a bounded range reports `truncated_tail` and a
  usable `next`.
- Valid output reads of oversized retained data return a bounded result instead
  of `limit_exceeded`, and their full serialized MCP responses remain below the
  endpoint limit.
- Text rows and ANSI snapshots match the canonical emulator at its captured
  geometry, omit raw paste markers and cursor-motion source, and reject
  `after` rather than claiming a false visual delta.
- Search is literal, snapshot-scoped, ordered, bounded by context/matches and
  byte budget, and exposes no reusable visual-row cursor.
- `run_command.from` is captured before the write and `command_id` is clearly
  a submission id; no test treats it as a completion or output-attribution id.
- `get_mcp_capabilities` distinguishes Desktop's unavailable structured waits
  from available host operations before an agent calls them.
- Contract fixtures require common Desktop/standalone fields while accepting
  documented host extensions; Docker Electron coverage runs with
  `npm run test:e2e`.
- Deterministic MCP coverage is a release requirement: it covers framing and
  parser edge cases, invalid UTF-8 and Unicode, cursor retention/loss and
  pagination, complete serialized control and MCP response bounds, invalid
  format/parameter combinations, global capability reporting, and required
  common-field adapter conformance.

## Definition of done

Both MCP hosts implement the governing output, search, command-submission,
availability, and response-conformance contracts; the focused unit/integration
coverage—including the deterministic MCP release coverage above—and Docker
Electron end-to-end suite pass. Move this task to `tasks_completed/` only after
that implementation is complete.
