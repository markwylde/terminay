## Why

Recordings of full-screen programs such as Claude Code could not be watched. Opening one showed "response exceeded protocol limits" and nothing played. Once that was fixed, replay drew the program garbled: wrapped fragments of old text down the left edge, and a frame that did not match the terminal it was recorded from. The Recordings page also kept showing a recording after it was deleted, its refresh button did nothing, and it did not look like the other Home pages.

Three faults caused this. A replay chunk travelled inline in the JSON frame header, where its already-escaped asciicast text is escaped again and can pass the 64 KiB header limit. The server recorder learned neither the terminal's size nor its resizes, so every cast said 80×24 and held no `r` events. And each recordings panel answered every list from a client cache that only its own mutations cleared.

## What Changes

- Replay content is carried in the query result body rather than the JSON header when the client asks for it, so any chunk within the replay read limit transfers. Clients and servers that do not ask, or do not answer that way, keep the inline form.
- A recording's header carries the terminal's live size when recording starts, and every applied resize, whichever client or path requested it, is recorded as an `r` event ahead of the output drawn for it.
- The recordings timeline reads the server afresh on load, refresh, return to the tab, and every 30 seconds while on screen. Deleting a recording anywhere removes it from the timeline.
- The timeline uses the Home page header, toolbar, and row styles, shows when it was last updated, and offers deletion from each row. The replay tab uses the same compact header and shows only metadata that is known.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `recording`: adds requirements for recorded dimensions, replay transfer size, and timeline freshness.

## Impact

- `packages/server-core/src/recordingService/` (`adapter.ts` replay body, `service.ts` live dimensions, `types.ts`) and `packages/server-core/src/composition.ts` (resize and dimension wiring).
- `packages/client-core/src/recordings.ts` (replay through `queryWithBody`).
- `src/components/RecordingsWindow.tsx`, `src/shared/SharedRecordingsLibraryPane.tsx`, `src/recordings.css`.
- Protocol: an optional `contentInBody` request flag and result marker on `recordings.replay`; no new operation and no capability change. Recordings already written keep their 80×24 headers.
