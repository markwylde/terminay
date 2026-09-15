## Why

On a phone, the terminal Paste button is the only practical way to get a screenshot into a shell. Today that button reads text only, so an iOS Safari clipboard that holds a screenshot does nothing. Desktop already turns an image-only clipboard into a temporary PNG and types its path; the web client needs the same outcome, with the file landing on the machine that owns the PTY.

## What Changes

- A user-initiated browser paste that holds an image (and no usable text) uploads that image to a server-owned temporary directory — on Unix, under `/tmp/terminay-clipboard/` — and inserts the shell-escaped absolute server path into the focused terminal.
- The mobile accessory Paste button, the terminal paste event (long-press Paste on iOS), and the terminal context-menu paste all use this path. Text clipboard content keeps today's exact-origin text paste.
- The client never chooses the destination path and never writes into the project. The server names the file, bounds the size, and returns the path the PTY can actually open.
- Desktop image paste is unchanged: Electron still materialises the PNG locally.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: browser paste is no longer text-only. An image-only clipboard is materialised on the server and the resulting path is inserted. Desktop clipboard preference order stays as specified.

## Impact

- `src/host/nativeActions.ts` and `src/components/terminalPasteInteraction.ts` — read image clipboard items inside the user gesture; keep Safari's activation window.
- `src/components/TerminalPanel.tsx` — mobile Paste, native paste event, and context-menu paste share one materialise-then-insert path.
- Server protocol — a bounded binary command that writes only into the server-owned clipboard directory and returns the absolute path.
- `packages/client-core` / `packages/server-core` — client facade and server handler; not `files.create`.
- Tests: unit coverage for preference order, size/type rejection, and path escaping; Playwright coverage for browser paste-event image upload. Real iOS Safari paste permission UI is not reproducible in Docker E2E and is called out as a device check.
