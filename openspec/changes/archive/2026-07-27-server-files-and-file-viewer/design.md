## Context

See proposal.md. The pre-existing filesystem stack was an Electron renderer
convenience: paths arrived from the renderer, watches were keyed by
`webContentsId`, and drafts lived in renderer memory. That model could not
serve a standalone server, a second connected client, or a remote browser
host, and it left path authorization spread over several call sites.

## Goals / Non-Goals

Goals:
- One server-side authorization boundary for every filesystem and file-session
  operation.
- Canonical, multi-client file-session state that survives client disconnect.
- Bounded transfer for arbitrarily large files without blocking terminal
  control traffic.

Non-Goals:
- Changing the rendered viewer experience. Monaco, Performant text, HEX,
  Preview, and diff behaviour are preserved, not redesigned.
- Full `TerminalClient`/E2E parity for every multi-client scenario; bounded
  server-core two-client coverage was accepted for this change.

## Decisions

- **Adapter as the only file boundary.** Metadata, ranged bytes and text,
  atomic save, reload, and keep-local are protocol commands on
  `ServerFileAdapter`. Each command re-resolves the canonical path and
  re-checks the exact server/project/session authorization rather than trusting
  a previously validated handle.
- **Watches keyed by identity, not by renderer.** Subscription identity is
  server/project/resource plus client subscription id, which makes watch
  delivery survive renderer reload and work for several clients at once.
- **Capabilities before content.** The server publishes bounded preview
  capability metadata (text, Markdown, image, PDF, binary/HEX fallback,
  large-file mode) without returning content bytes, so mode selection is
  deterministic and server-authorized. `FilePanel` disables server-denied modes
  and resolves an unavailable requested mode to the server-authorized fallback.
- **Monaco is bounded.** Monaco engine selection is capped at the shared
  128 MiB rich-editor budget; larger text files resolve directly to the ranged
  Performant viewer. Switching a Performant sparse text draft into Monaco
  materializes the edited projection and preserves its dirty state.
- **Deterministic recursion for tasks.** Directory ordering is applied before
  bounded recursive Markdown aggregation, so a partial result does not depend
  on host directory enumeration order.
- **Resync over invented continuity.** A stale watch cursor forces a bounded
  restart from offset zero rather than a silently patched stream.

## Risks / Trade-offs

- Server round-trips replace in-process filesystem calls; mitigated by bounded
  pagination, chunking, deduplication, and cancellation so viewer traffic
  cannot starve terminal control.
- Canonical drafts held on the server must be released deliberately; dirty
  drafts are retained through client disconnect and released only through the
  documented panel lifecycle, which trades server memory for data safety.
- Two-client coverage is bounded to server-core (`file-multi-client.test.mjs`);
  full client E2E parity remained open at the time of this change.

## Migration Plan

Electron filesystem IPC paths were replaced rather than dual-run: the Electron
host registers the canonical project root with the embedded server before each
scoped request, and `FolderPanel` uses the connected `FileViewerClient` instead
of renderer-side directory recursion.
