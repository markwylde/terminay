## Why

A user connected from Terminay Desktop to a remote Terminay Server cannot copy from programs running there. Claude Code says it has copied a response, but nothing reaches the Mac's clipboard, and nothing reaches a clipboard on the server either, because a headless server has none. The same is true of tmux, Neovim and any other program that copies over SSH.

Those programs fall back to OSC 52, an escape sequence that asks the terminal emulator to put text on the clipboard of the device showing it. Terminay's xterm.js terminals have no OSC 52 handler, so the sequence is silently dropped.

## What Changes

- A terminal writes the text of a live OSC 52 copy request to the clipboard of the device showing it: through the Desktop bridge's existing clipboard write on Desktop, and through the Clipboard API in a browser.
- The query form (`52;c;?`) is never answered. No program can read the clipboard through the terminal.
- History replayed on attach, on reconnect, from a checkpoint or from a recording never writes the clipboard.
- Copy requests that are malformed, over 1 MiB, not UTF-8, or carry control characters other than tab and line breaks are ignored. An empty request does not clear the clipboard.
- A new device setting, **Programs can copy to the clipboard**, on by default, turns this off.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workspace`: adds a requirement for program clipboard writes through OSC 52.
- `settings-shortcuts-and-desktop-integration`: adds the **Programs can copy to the clipboard** connection-host setting.

## Impact

- `src/components/terminalOsc52.ts` (new): parser and handler; `src/components/TerminalPanel.tsx`: registers the handler and marks live output.
- `src/types/settings.ts`, `src/terminalSettings.ts`, `packages/server-core/src/settings/classification.ts`: the setting.
- Tests: `src/components/terminalOsc52.test.ts`; an E2E scenario in `e2e/terminal.spec.ts`.
- No protocol, bridge, IPC or server change. The Desktop `clipboard.write` action and its 1 MiB bound already exist.
- New ADR: `openspec/adr/0112-terminal-output-may-write-but-never-read-the-viewing-devices-clipboard.md`.
