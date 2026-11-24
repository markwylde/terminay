## Why

Dropping a file on a Desktop terminal whose server is remote now copies it to that server (`remote-file-drop`). Pasting does not. Copying a file in Finder, or a screenshot tool that puts a file on the clipboard, and pressing Cmd+V in the same terminal still inserts the Mac's own path, for example `/Users/mark/Pictures/Screenshots/shot.png`, which the remote shell cannot open. An image-only clipboard has the same fault: Electron writes a PNG into this Mac's temporary directory and inserts that path.

## What Changes

- A Desktop paste into a terminal whose server is this machine's own Local server is unchanged: copied files paste as native paths, then text, then an image as a local temporary PNG.
- A Desktop paste into any other terminal copies the clipboard's files to the terminal's server through the same upload a drop uses, with the same progress indicator and Stop control, and inserts the shell-escaped `terminay-drops` paths. An image-only clipboard is materialised on the server like a browser paste. Text pastes as text.
- A copied folder, or a server that cannot receive files, produces a visible failure and inserts nothing. A client-local path is never inserted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: **Desktop clipboard preference order** chooses local paths or a server-side copy by where the terminal runs.

## Impact

- `electron/terminalClipboardUpload.ts` (new), `electron/main.ts`, `serverUiHost.ts`, `serverUiPreload.ts`, `serverUiHostContract.ts`: a clipboard read that names copied files without their paths, and a bounded part read limited to the files the latest read named.
- `src/components/terminalPasteInteraction.ts`, `TerminalPanel.tsx`, `src/host/nativeActions.ts`: the remote Desktop paste route, sharing the drop's upload and indicator.
- No protocol or server change: the existing `terminal-file-drop.v1` upload and clipboard image materialisation are reused.
