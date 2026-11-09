## Why

Full-screen and raw-mode terminal programs render scrambled in Terminay while they render correctly in iTerm2, Ghostty and xterm. The Antigravity CLI (`agy`) is the reported case: its logo, header text and footer land in the wrong columns. Terminay turns on xterm.js `convertEol` by default, so every bare line feed (LF) also returns the cursor to column 0. Programs in raw mode send a bare LF to mean "move down one row and keep the column", and Terminay breaks that.

Replaying `agy`'s captured output through `@xterm/headless` reproduces both terminals exactly: with `convertEol: false` it matches iTerm2, and with `convertEol: true` it matches the broken Terminay screenshot.

## What Changes

- The **Convert LF to CRLF** terminal setting (`convertEol`) defaults to off. A bare LF moves the cursor down a row and leaves the column alone, as in every mainstream terminal. Ordinary shell output is unaffected because the PTY line discipline (`onlcr`) already turns LF into CR LF for programs that are not in raw mode.
- The setting stays available. Users and MCP clients can still turn it on.
- **BREAKING (saved preference):** A one-time server-settings migration resets a stored `convertEol: true`, because every existing snapshot stores the old default explicitly. Bumping the server settings schema to 3 marks the migration as applied, so a later explicit opt-in is respected. The migration runs only when a stored snapshot is loaded, never on settings commands. A user who deliberately chose `true` before this change is reset once and has to turn it back on.
- A regression test replays raw-mode output (bare LF followed by text that relies on the column staying put) through headless xterm with the options Terminay builds. It asserts the screen layout.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds a requirement that terminals treat a bare line feed per standard terminal semantics by default, with line-feed conversion available only as an explicit opt-in.

## Impact

- `src/terminalSettings.ts`: default, and the setting's description.
- `packages/server-core/src/settings/`: `defaults.ts` default, `types.ts` schema version 3, `normalize.ts` migration and the shell-migration version guard.
- Tests: `packages/server-core/test/settings.test.mjs`, plus a new `src/terminalLineFeed.test.ts` wired into `npm run smoke`.
- Every existing install is affected exactly once. Its stored `convertEol: true` becomes `false` on first load of the new server, behind the repository's existing backup-then-commit migration path.
