## Why

`run_command` wraps every command in bracketed-paste markers (`ESC[200~ … ESC[201~`)
whether or not the foreground program has enabled bracketed paste. Shells that
never enable it — `sh`/dash, busybox `ash`, many REPLs — read the markers as
literal characters glued to the first and last words, so the command breaks.
A leading assignment such as `PGPASSWORD=$(cat f) psql …` becomes an unknown
command name, and the shell's "not found" error prints the secret to the
terminal.

## What Changes

- `run_command` frames the command with bracketed-paste markers only when the
  target session's canonical emulator reports bracketed paste enabled
  (DECSET 2004). Otherwise it submits the command as a plain paste: line breaks
  become carriage returns, so each line is submitted in turn, followed by the
  submission carriage return.
- The embedded Desktop and standalone server `run_command` paths share one
  server-core helper, so the two cannot drift.
- The `run_command` result gains `bracketed`, reporting which framing was used.
- The `run_command` tool description states the conditional framing.
- `write_terminal` is unchanged and keeps writing exactly the text it is given.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: `run_command` uses bracketed paste only when the foreground
  program has enabled it, and its result reports the framing used.

## Impact

- `packages/server-core/src/terminalService/` — bracketed-paste mode read from
  the presentation emulator, and the shared command-submission helper.
- `apps/terminay-server/src/mcp/terminalAdapter.ts`, `apps/terminay-server/src/mcp/stdio.ts`
  — standalone `run_command` and its tool description.
- `electron/main.ts` — embedded `run_command`.
- Tests: `packages/server-core/test/`, `apps/terminay-server/test/terminal-adapter.test.mjs`.
