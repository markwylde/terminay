## Context

`write_terminal` with `submit: true` wrote `text + "\r"`; `run_command`,
window messages, and workflow typing wrote `paste + "\r"`; each as a single PTY
write. A program reading the PTY usually receives one write in one read.
Claude Code's input handler treats a multi-character read as typed or pasted
text, and a carriage return inside it becomes a newline in the prompt. Tested
over node-pty against Claude Code 2.x with a 180-character message:

The full results and the probe script are in
`openspec/adr/evidence/agent-cli-enter-submission/`. Text and `\r` in one
write is not submitted. The same text, then `\r` in a later write 20, 50, or
150 ms afterwards, is.

Models cannot emit raw control characters in tool-call JSON reliably: a
`"\r"` in the model's output is the two characters `\` and `r`, and raw C0
characters are dropped, leaving an empty string.

## Goals / Non-Goals

**Goals:**

- Enter from any Terminay tool submits in agent CLIs as it does in shells.
- An agent can press Backspace, Escape, arrows, Ctrl+C, and Enter on its own.
- A call that writes nothing says why.

**Non-Goals:**

- Detecting which program is in the foreground. The pause costs 50 ms per key
  and is harmless to shells, so it applies everywhere.
- Arbitrary escape sequences. Keys are a fixed set; raw bytes stay out of the
  MCP surface.

## Decisions

**Text, then each key on its own, with a 50 ms pause between writes.** One
helper, `writeSeparatedInput`, in server-core, writes the body, then each key
press. It pauses between writes, so a key that follows text waits 50 ms, and a
key with no text before it is written at once. Every host path calls it with
its existing write function, so recording, accepted-write notification, and
input-source rules are unchanged. 50 ms clears the tested 20 ms with margin and
is short enough not to matter to a human or an agent.

**One submission at a time per terminal.** Two automated submissions to the
same terminal could otherwise interleave as `text A`, `text B`, `Enter A`. The
helper takes a terminal key and queues each submission behind the previous one
for that terminal, in-process, so a submission's writes are contiguous with
respect to other Terminay submissions. A human typing in the same 50 ms can
still interleave, as with any paste. The queue holds no lock after a
submission ends, whether it finishes, fails, or is cancelled.

**Cancellation stops the remaining writes.** The helper takes the operation's
`AbortSignal` and checks it before every write. A request cancelled during a
pause writes nothing more and fails as `cancelled`, as the control protocol
requires of an aborted request.

**A failed write ends the submission.** If any write fails, the remaining keys
are not written and the call fails with that write's error. Text already
written stays in the terminal. Terminay does not retry: retrying the whole call
would type the text twice.

**Named keys instead of escape parsing.** Interpreting `\r` or `\x03` in text
would change what "exact text" means and break callers that send a literal
backslash. A fixed list of names is explicit, validates cleanly, and is what a
model can actually produce.

**The key-name list lives in `apps/terminay-server/src/mcp/terminalKeys.ts`**,
pinned to server-core's `TerminalKey` type with `satisfies` and an
exhaustiveness check, so the stdio entry keeps no runtime server-core import,
as the other tool modules do.

**`text` becomes optional; an empty call is refused in parsing** with a
message naming `keys` and `submit`, before it reaches the terminal service.

## Risks / Trade-offs

- A program that treats a lone Enter differently from a pasted one → that is
  the behaviour a human gets when pressing Enter, which is what the tools
  promise.
- A program that stalls longer than the pause can still read text and Enter
  together → the pause makes the common case work and is not a guarantee; the
  evidence records this limit.
- A long `keys` list holds the terminal's submission queue for up to about 3 s
  (64 keys × 50 ms) → other Terminay submissions to that terminal wait their
  turn; human input is unaffected.
- `run_command` and window messages now take 50 ms longer → negligible against
  any command or agent turn.
