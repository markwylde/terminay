## Context

`recordings.replay` returned `{ …metadata, content }` as the query result, which the protocol encodes into the frame header (limit 64 KiB). The default chunk is 64 KiB of asciicast NDJSON; each line is already JSON, so quotes, backslashes, and `\u001b` escapes grow again when nested, and a chunk of colour-heavy output reached about 70 KiB. Records can be up to the 256 KiB chunk limit, so trimming chunks could not fix it.

The canonical `RecordingService` is fed by `createServerCoreComposition`, which forwarded only output and exit events. `start()` took its size from remembered session metadata, which nothing populated, and fell back to 80×24. Desktop's renderer resizes through `terminal.resize`, which reaches `TerminalService.resize` without passing the Desktop authority's own resize hook.

`RecordingsListPanel` and `RecordingReplayPanel` each build a `RecordingsClient`, whose `list()` caches results until that same client mutates.

## Goals / Non-Goals

**Goals:**
- Any chunk the server is willing to read reaches the client.
- A cast's header and `r` events match what the program drew for.
- The timeline reflects the server after refresh, return, and deletion elsewhere.
- Recordings pages match the other Home pages.

**Non-Goals:**
- Server-pushed recording events.
- Snapshotting the screen when recording starts mid-session.
- Rewriting headers of recordings already on disk.

## Decisions

1. **Replay content moves to the result body on request.** The client sends `contentInBody: true`; the server answers with metadata as the result (marked `contentInBody: true`) and UTF-8 content as the body. Without the flag the server answers inline, and a client that receives no marker reads the inline result. This keeps older peers working in both directions. Alternative rejected: shrinking chunks to fit the header cannot carry a single record above about 30 KiB.
2. **The recorder reads size from the terminal service.** Composition gives `RecordingService` a resolver over `TerminalService.getSession(id).dimensions` and subscribes `TerminalService.onResize` to `appendResize`. The service reports a resize after validating it and before the PTY redraws, so the `r` event precedes the output drawn for it. Alternative rejected: wiring Desktop's authority hook, which a protocol resize never passes.
3. **Resizes do not update persisted session metadata.** The live resolver makes it unnecessary, and persisting on every resize would write metadata repeatedly while a window is dragged.
4. **The timeline never answers from the cache.** Each read invalidates the client cache first. A 30-second refresh while visible stands in for recording events.

Boundaries: the recording service stays in Terminay Server; the renderer still reaches recordings only through the canonical `RecordingsClient`. The terminal-session boundary is unchanged: the resolver and resize observer are keyed by the session the recording already belongs to.

## Risks / Trade-offs

- [A recording started mid-session misses the screen already drawn] → out of scope; replay begins from the next redraw.
- [30-second refresh adds list queries] → only while the timeline is on screen, and a list is one bounded query.
