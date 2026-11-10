## Why

Pixel was asked to tell the Claude Code session in another tab to merge a pull
request. It typed the message with `write_terminal` and `submit: true`, but
Claude Code never submitted it, and nothing Pixel tried afterwards could press
Enter:

- `write_terminal` with `submit: true` writes the text and its carriage return
  in one PTY write. Claude Code, like other agent CLIs that read their own
  keyboard, treats a carriage return arriving in the same read as preceding
  text as part of a paste, so it adds a newline and does not submit.
  Reproduced against Claude Code over node-pty: text and `\r` together are not
  submitted; the same text, then `\r` in a later write, is.
- `run_command` has the same shape: the paste and its `\r` go in one write, so
  an empty `run_command` did not submit either.
- A model cannot reliably put control characters in tool arguments. Pixel's
  `"\r"` arrived as a literal backslash and `r`, and a raw Backspace or Ctrl+C
  arrives as an empty string, which the terminal service refuses as invalid
  bytes, surfaced as the opaque "The control operation parameters are invalid."
  Pixel read that as "control characters are blocked" and gave up.

Every MCP agent driving another agent's terminal, Pixel, bots, and agents in
terminals alike, hits this. App-window messages and workflow launch text use
the same one-write submission.

## What Changes

- Typed input is written as the text, then each key press on its own after a
  short pause (50 ms). This applies to `write_terminal`, `run_command`,
  window messages, and workflow launch and resume text, in both the standalone
  server and the embedded Desktop host.
- `write_terminal` gains `keys`, a list of named keys (Enter, Backspace,
  Escape, arrows, Ctrl+C and others) pressed after the text, and `text`
  becomes optional, so `submit: true` alone presses Enter.
- A `write_terminal` call that would write nothing is refused with a message
  that says to use `keys` or `submit`, instead of the generic invalid-bytes
  error.
- The `write_terminal` tool description explains text, keys, and submit, and
  how to send a message to an agent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: `write_terminal` and `run_command` write Enter as its own key
  press; `write_terminal` accepts named keys.
- `terminal-app-windows`: a window message's Enter is written on its own.
- `terminal-workflows`: launch and resume Enter is written on its own.

## Impact

- `packages/server-core/src/terminalService/commandSubmission.ts` — the paste
  helper, named keys, and `writeSeparatedInput`.
- `packages/server-core/src/composition.ts` — window messages and workflow
  typing.
- `apps/terminay-server/src/mcp/` — `terminalAdapter.ts`, `dispatcher.ts`,
  `stdio.ts`, and a new `terminalKeys.ts`.
- `electron/main.ts` — embedded `write_terminal` and `run_command`.
- Tests in `packages/server-core/test/` and
  `apps/terminay-server/test/terminal-adapter.test.mjs`.
