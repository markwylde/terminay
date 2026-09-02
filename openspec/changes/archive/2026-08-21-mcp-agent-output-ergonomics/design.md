## Context

See proposal.md. The honesty problem is the important one: a text or ANSI read
describes what the emulator is currently showing, which is not the same thing as
a range of the byte stream. Presenting it with a cursor would invite an agent to
page through a transcript that does not exist.

## Goals / Non-Goals

Goals:
- Lossless raw output that an agent can page through without overlap or gaps.
- Emulated presentation reads that say plainly that they are snapshots.
- One implementation of each behaviour, shared by both MCP hosts.
- Every response bounded below the endpoint limit.

Non-Goals:
- Command-to-exit correlation or output attribution for a submitted command.
- Incremental deltas of the emulated screen.
- Unbounded terminal-history search.

## Decisions

- **Two representations, two contracts.** Raw is a byte range with a cursor;
  text and ANSI are snapshots of the current emulated state at a captured
  geometry. A snapshot read rejects a cursor argument rather than claiming a
  false visual delta.
- **The raw reader lives in the server.** It validates the source cursor,
  captures a terminal high-watermark, returns exact bounded bytes with retention
  metadata, and does not create an oversized replay subscription. Both adapters
  use it, so Desktop's tail buffer stops being a second source of truth for MCP
  reads.
- **Cursor faults are distinguished.** A stale cursor reports history loss and
  the current replay start; a future cursor is rejected; a bounded range reports
  a tail truncation with a usable next cursor. Collapsing these into one error
  would leave an agent unable to tell recoverable from invalid.
- **Budgets are measured on the complete serialized response**, not on the
  payload alone, with a response-safe 16 KiB default and a 64 KiB public cap.
  Valid reads of oversized retained data return a bounded result rather than a
  limit-exceeded failure, because failing a legitimate read is worse than
  truncating it with an explicit signal.
- **Search is literal and snapshot-scoped**, ordered and bounded by context,
  match count, scan extent, and byte budget, and it exposes no reusable visual-
  row cursor — a cursor into a snapshot would be meaningless by the next read.
- **`command_id` is a submission id.** `from` is captured before the write is
  accepted so the agent has a valid lower bound for reading what followed. No
  command-to-exit correlation is added, and no test may treat `command_id` as a
  completion or attribution id.
- **Capabilities are adapter-global.** `get_mcp_capabilities` lets an agent
  discover that Desktop lacks structured waits before calling them, while
  unavailable registered tools keep their stable unsupported-operation failure.
- **Conformance is fixture-driven.** Shared fixtures require the common fields
  from both adapters and allow documented host extensions, so the two hosts
  cannot drift apart quietly.

## Risks / Trade-offs

- A 64 KiB public cap means an agent reading a very noisy terminal must page,
  which is more round trips but keeps every response deliverable.
- Snapshot-only search cannot find text that has scrolled out of the emulated
  screen. That limitation is stated in the contract rather than worked around
  with an unbounded history scan.
