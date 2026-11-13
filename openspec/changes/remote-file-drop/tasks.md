## 1. Protocol and server

- [x] 1.1 Add the `terminalFileDrop` (`terminal-file-drop.v1`) feature capability to `packages/protocol`, declare it as optional in `CLIENT_SERVER_COMPATIBILITY`, and advertise it from `composition.ts`. Verify with `capability-coverage.test.mjs`.
- [x] 1.2 Give `AppWindowAttachmentWriter` a configurable part size and file naming, and export `ownedScratchDirectory`, leaving window attachments unchanged. Verify with the existing app-window attachment tests passing.
- [x] 1.3 Add `TerminalFileDrops` (`terminalService/fileDrop.ts`). It creates a 0700 per-drop folder under `terminay-drops`, keeps names unique within a drop, ties each upload to the connection that began it, abandons uploads that go idle or whose connection closes, and limits each connection to 4 uploads. Verify with `test/terminal-file-drop.test.mjs`.
- [x] 1.4 Register `terminal.drop-begin/-part/-finish/-cancel` in the terminal operation registry with write scope, authorised like the clipboard image command, and map the new error codes in the dispatcher. Verify with `test/terminal-file-drop-wire.test.mjs` over a real client/server connection.

## 2. Client

- [x] 2.1 Add `TerminayTerminalClient.uploadDroppedFiles`, which streams parts, reports progress and cancels on failure or abort. Verify with the wire test.
- [x] 2.2 In `terminalDropInteraction.ts`, replace the project-root browser upload with `uploadTerminalDropFiles` and `droppedFileSources` (folder detection). Verify with `src/components/terminalDropInteraction.test.ts`, added to `npm run smoke`.
- [x] 2.3 In `TerminalPanel`, insert native paths only on Desktop when the terminal's server is Local. Otherwise upload when the server advertises the capability, show an Uploading indicator with Stop, and report a folder, an unsupported server or a failure visibly. Verify with `tsc` and the e2e tasks below.

## 3. End to end and docs

- [x] 3.1 Keep the Desktop local-drop e2e (`terminal.spec.ts`), which proves Local still inserts the native path, and add `desktop-loopback-standalone-pairing.spec.ts`, which drops a native file on a paired standalone server's terminal, asserts a `terminay-drops` path and runs `cat` on it. Verify with `npm run test:e2e` for both specs.
- [x] 3.2 Document `terminay-drops` next to `terminay-attachments` in `docs/operations/standalone-server.md`.
- [x] 3.3 Run `openspec validate --all`. This change validates.
