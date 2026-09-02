## Why

MCP agents needed bounded, honest terminal-output workflows. Lossless raw PTY
output had no cursor to page through, and text and ANSI reads were presented as
if they were byte-range transcripts when they are really a snapshot of the
current emulated presentation. Desktop also read output through its own tail
buffer, so the two MCP hosts could disagree about what a terminal had produced.

## What Changes

- A shared server-owned raw replay-range reader is used by both the Desktop and
  standalone MCP adapters, and **BREAKING** Desktop's independent tail-buffer
  read path is removed from MCP output reads.
- The canonical presentation authority gains a bounded read of its current
  emulated state and geometry, with visual-row extraction, wrapping, and safe
  ANSI serialization defined once for both hosts.
- `read_terminal` gains format-specific inputs: raw Base64 pagination, and
  text/ANSI snapshot results with response-safe 16 KiB defaults, 64 KiB public
  caps, complete-response measurement, and distinct history, pagination, and
  presentation truncation signals.
- `search_terminal` performs a bounded literal snapshot search with case,
  context, match, scan, and response-size rules.
- `run_command` returns `command_id`, `from`, `submitted_bytes`, and
  `submitted: true`, where `from` is captured before the write and `command_id`
  is explicitly a submission id.
- `get_mcp_capabilities` states adapter-global tool availability so an agent can
  learn which optional wait operations exist before calling them.
- Shared required-response schema fixtures assert common fields across both
  adapters while allowing documented host extensions.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `mcp-server`: two clearly distinguished output representations, bounded
  paginated raw reads, snapshot-only presentation reads and search, submission
  metadata on `run_command`, capability reporting, and cross-host response
  conformance.

## Impact

`server-core` replay-range and presentation-read APIs, both MCP adapters, the
dispatcher and stdio schemas, the response-size budget logic, and the shared
contract fixtures. Docker Electron end-to-end coverage runs only through
`npm run test:e2e`.

Out of scope, and deliberately not added: correlating a submitted command with
shell completion, exit status, or precisely attributable output; incremental
emulated-screen deltas; and unbounded terminal-history search.
