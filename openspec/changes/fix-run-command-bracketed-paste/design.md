## Context

Both `run_command` implementations — `apps/terminay-server/src/mcp/terminalAdapter.ts`
and `electron/main.ts` — build the PTY input as
`` `\u001b[200~${command}\u001b[201~\r` ``. The spec only calls for bracketed
paste on multiline input, and the desktop paste path already follows xterm.js,
which adds the markers only while mode 2004 is set.

The server already knows the mode. Every session with presentation checkpoints
has a server-owned `@xterm/headless` emulator in
`TerminalPresentationCheckpointAuthority`, fed the exact PTY output, and xterm
tracks `modes.bracketedPasteMode` from DECSET/DECRST 2004. Both hosts reach it
through the same `TerminalService`.

## Goals / Non-Goals

**Goals:**

- `run_command` behaves like the user pasting the command and pressing Enter.
- One implementation of the framing decision, used by both hosts.
- The result says which framing ran.

**Non-Goals:**

- Changing `write_terminal`, which writes exactly the text it is given.
- Changing the `invalid_token` failure, whose single generic message is
  deliberate: invalid tokens must not reveal valid scopes.
- Sanitising `ESC[201~` inside a command.

## Decisions

**Read the mode from the canonical presentation emulator after it has parsed
admitted output.** `TerminalService.bracketedPasteMode(session)` waits for the
presentation queue to settle (bounded by the existing settle deadline, so a
terminal that never falls silent cannot stall the call), then reads
`modes.bracketedPasteMode` from the authority. Reading without settling would
race a prompt that has just enabled the mode.

**Unknown means off.** With no presentation emulator, or an unavailable one, the
command is sent as a plain paste. Plain input works in every shell; stray
markers do not. The cost is that a multiline command in a bracketed-paste shell
without an emulator runs line by line, which matches pasting into a terminal
without the mode.

**Plain paste converts line breaks to carriage returns**, as xterm.js does for a
paste, so each line is submitted. Bracketed framing is unchanged from today.

**One pure helper, `commandSubmissionInput(command, bracketed)`, in
server-core.** Both hosts call the service for the mode and the helper for the
bytes, and keep their existing write path so recording and activity boundaries
are untouched.

Alternative considered: a `TerminalService.submitCommand` that writes too.
Rejected — Desktop writes through `ServerTerminalAuthority.write`, which adds
accepted-write notification; moving the write would bypass it.

## Risks / Trade-offs

- A program can change the mode between the read and the write → the same race
  exists for a human paste; the window is one event-loop turn.
- A busy terminal past the settle deadline is read with slightly stale mode →
  bounded, and the deadline already governs attach hydration.

## Migration Plan

None. The result gains an additive field; rollback is reverting the commit.

## Open Questions

None.
