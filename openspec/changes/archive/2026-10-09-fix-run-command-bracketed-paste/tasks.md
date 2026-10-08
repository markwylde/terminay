## 1. Server-core

- [x] 1.1 Add `bracketedPasteMode(identity)` to `TerminalPresentationCheckpointAuthority`
      and `bracketedPasteMode(session)` to `TerminalService`, settling the
      presentation queue first and reporting `false` when the emulator is
      absent or unavailable. Verified by a server-core test toggling
      `ESC[?2004h` / `ESC[?2004l`.
- [x] 1.2 Add and export `commandSubmissionInput(command, bracketed)`. Verified
      by tests: markers present when on, absent when off, and `\n` / `\r\n`
      converted to `\r` when off.

## 2. Hosts

- [x] 2.1 Use the mode and helper in the standalone `run_command` and return
      `bracketed`. Verified by `terminal-adapter.test.mjs` covering both modes.
- [x] 2.2 Use them in the embedded Desktop `run_command`. Verified by typecheck.
- [x] 2.3 Update the `run_command` tool description. Verified by reading it.

## 3. Verification

- [x] 3.1 `npx openspec validate fix-run-command-bracketed-paste --strict`.
- [x] 3.2 `npm run lint`, `npm run typecheck`, and the touched unit suites exit zero.
- [x] 3.3 Open the pull request and read back green CI statuses.
