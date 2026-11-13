## Why

Dragging a file from the Mac onto a terminal that runs on a remote Terminay Server pastes the Mac's own path, for example `/Users/mark/Pictures/Screenshots/shot.png`. The remote shell, or the coding agent running in it, cannot open that path because the file is not on its machine. The same drop works on the local server only because both sides share one filesystem.

The browser client (PWA, including iPad) has a related gap. It uploads dropped files into the project root, so they show up in `git status`, and it refuses anything over 4 MB.

Clipboard images already solve this. The server writes the bytes into a scratch directory it owns and the client pastes the server's path (ADR-0023). Dropped files should work the same way.

## What Changes

- Dropping operating-system files on a Desktop terminal whose server is this machine's own Local server still inserts their native paths, without copying them.
- Dropping files on a terminal whose server is remote, from Desktop or from a browser, streams each file in bounded, acknowledged parts into `terminay-drops` under the server's temporary directory, in a per-drop folder that keeps the original file name. The shell-escaped server paths are inserted once every file has arrived.
- Uploads have no size cap. A progress indicator with a Stop control is shown while files upload, and a stopped or failed drop inserts nothing and removes the partial files.
- A dropped folder cannot be copied and is refused with a visible message. A server that does not advertise the new `terminal-file-drop.v1` capability also gets a visible refusal, never a client-local path.
- **BREAKING (browser drop destination):** browser drops no longer write into the project root, and the 4 MB cap is gone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: **File drop behaviour** now chooses the native path or a server-side copy based on where the terminal runs, and the server-side copy has its own scratch-write contract.

## Impact

- `packages/protocol`: a new `terminalFileDrop` feature capability, declared as optional by the bundle.
- `packages/server-core`: drop operations in the terminal operation registry (begin, part, finish, cancel), built on the existing streamed scratch writer (`AppWindowAttachmentWriter`), and the capability advertised by composition.
- `packages/client-core`: `TerminayTerminalClient.uploadDroppedFiles`.
- `src/components/terminalDropInteraction.ts` and `TerminalPanel.tsx`: deciding between local and remote, the upload indicator, and the drop error messages. The project-root browser upload is removed.
- New ADR: dropped files are a third named scratch write.
