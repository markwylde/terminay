## 1. Replay transfer

- [x] 1.1 Return replay content as the query result body when the request sets `contentInBody`, and read it through `queryWithBody` in `RecordingsClient`, falling back to inline. Verified by a client-core test that replays more than 64 KiB of escape-heavy output through the framed protocol; it fails on `main` and passes after.

## 2. Recorded dimensions

- [x] 2.1 Give `RecordingService` a live dimension resolver and record `TerminalService` resizes from composition. Verified by `recording-terminal-dimensions.test.mjs`: a terminal created at 132×41 records that header and an `r 150x50` event between its output; it fails on `main` with `[80, 24]`.

## 3. Timeline and replay UI

- [x] 3.1 Invalidate the client cache on every timeline read, refresh while visible, and remove a deleted recording at once. Verified by the e2e test `deleting a recording from its replay removes it from the timeline`, and by the existing e2e steps that refresh until a new recording is listed.
- [x] 3.2 Use the Home header, toolbar, and row styles, the "Updated …" label, row deletion, and a compact replay header. Verified by comparing the pages beside Workflows, Pull Requests, and Bots in the dev app.

## 4. Checks

- [x] 4.1 Run the recordings client, server composition, recording service, and recordings UI unit suites, the recordings e2e spec, typecheck, and lint. Verified by clean runs; one unrelated macros assertion in `web-auxiliary-route-controller.test.mjs` fails on `main` too.
- [x] 4.2 Run `openspec validate --all`. Verified by this change passing.
