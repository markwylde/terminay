## 1. Electron

- [x] 1.1 Add `TerminalClipboardUploadReader` (`electron/terminalClipboardUpload.ts`): name copied files without paths, report a folder, fall through to text then PNG bytes, and read bounded parts only for the latest read's token. Verify with `electron/terminalClipboardUpload.test.ts`, added to `npm run smoke`.
- [x] 1.2 Expose it through the server UI host binding and preload as `readTerminalClipboardForUpload` and `readTerminalClipboardFilePart`. Verify with `tsc`.

## 2. Renderer

- [x] 2.1 Add `pasteDesktopClipboardForUpload` to `terminalPasteInteraction.ts`. Verify with `scripts/terminal-paste-interaction.test.mjs`.
- [x] 2.2 In `TerminalPanel`, share one upload helper between drop and paste, and route Cmd+V, Edit > Paste and the context-menu paste on Desktop by whether the terminal's server is Local. Verify with `tsc` and the existing drop e2e.

## 3. Validation

- [x] 3.1 Run `openspec validate --all`.
