## 1. Viewer

- [x] 1.1 Add an optional `readHostText` to `DesktopClipboardEnvironment`. When it is set, the paste shortcut is cancelled, auto-repeat is ignored, the text is read, and it is sent with the modifiers held at that moment. Verify with `desktopClipboard.test.ts` cases:
  - the shortcut is cancelled, read once, and pasted with the macOS chord;
  - a Cmd released before the read resolves is not pressed again;
  - no text, too much text, or a failed read sends nothing.
- [x] 1.2 In Desktop, wire `readHostText` in `BotDesktopView.tsx` to `desktopClipboardUploadRoute().read()`, text kind only. Verify with the repo typecheck and Biome.

## 2. Decision

- [x] 2.1 Record ADR-0132, which supersedes ADR-0129 decision 2 in part, and add it to the ADR README.

## 3. Verification

- [x] 3.1 Run the real module in Electron from the e2e image. The setup has an Edit menu with role paste, a preload bridge whose main process reads `clipboard.readText()`, and a selection left elsewhere on the page. Ctrl+V on the desktop must send the host text and Ctrl+V to the bot, with focus kept on the desktop. Record the run in `evidence/` and `verification.md`.
