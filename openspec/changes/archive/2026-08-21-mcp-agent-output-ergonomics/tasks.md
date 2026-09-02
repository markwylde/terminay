## 1. Shared server-owned readers

- [x] 1.1 Add a server-core raw replay-range API that validates a source cursor,
  captures a terminal high-watermark, returns exact bounded bytes and retention
  metadata, and verify it does not create an oversized replay subscription
- [x] 1.2 Use that API from both MCP adapters and verify Desktop's independent
  tail-buffer read path is removed from MCP output reads
- [x] 1.3 Extend the canonical presentation authority with a bounded read of its
  current emulated state and geometry, defining visual-row extraction, wrapping,
  and safe ANSI serialization once for both hosts

## 2. Tool contracts

- [x] 2.1 Extend dispatcher and stdio schemas for format-specific
  `read_terminal` inputs and implement raw Base64 pagination and text/ANSI
  snapshot results with 16 KiB defaults, 64 KiB public caps, complete-response
  measurement, and distinct history, pagination, and presentation truncation
  signals
- [x] 2.2 Add `search_terminal` validation and bounded literal snapshot search,
  verifying its case, context, match, scan, and response-size rules allocate no
  unbounded row or result array
- [x] 2.3 Return `command_id`, `from`, `submitted_bytes`, and `submitted: true`
  from `run_command` in both adapters, capturing `from` before accepting the
  write and adding no command-to-exit correlation
- [x] 2.4 Add `get_mcp_capabilities` from the bound adapter and use it to state
  Desktop and standalone availability of optional wait operations, verifying
  stable `unsupported_op` failures are preserved for unavailable registered tools

## 3. Verification

- [x] 3.1 Define shared required-response schema fixtures and test both adapters
  against them while allowing documented host extensions
- [x] 3.2 Add MCP stdio schema and complete-response-size tests
- [x] 3.3 Add server-core and adapter tests for binary and invalid UTF-8 raw
  output, stale and future cursors, pagination boundaries, history loss, resize
  and cursor-motion presentation, escaped bracketed paste, search bounds, and
  command submission metadata
- [x] 3.4 Verify a raw read decodes byte-for-byte to retained output and that
  successive calls with the returned cursor cover a retained stream without
  overlap
- [x] 3.5 Verify valid reads of oversized retained data return a bounded result
  rather than a limit-exceeded failure, with the full serialized response below
  the endpoint limit
- [x] 3.6 Verify no test treats `command_id` as a completion or output-
  attribution id
- [x] 3.7 Run Electron end-to-end coverage only through `npm run test:e2e`
