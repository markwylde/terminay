## Context

Workflow launch and resume (`terminal-workflows`, ADR-0097) are the only
terminal writes a workflow causes. Server-core's workflow operation registry
calls `typeText`, which `composition.ts` implements as one bracketed paste
(or, without bracketed paste, a whitespace-flattened plain write) followed by
`\r` on its own after 50 ms, through `writeSeparatedInput` and
`terminalInputSources.write` with source `workflow`.

The launch text always starts with `/goal`, a Claude Code slash command.
Claude Code runs a slash command only when it is typed. Measured over node-pty
(`openspec/adr/evidence/workflow-goal-typing/`):

- bracketed paste: never runs;
- unbracketed, one write of ~1 KB, or ≥512-character chunks with no pause, or
  256-character chunks 2 ms apart: shown as `[Pasted text]`, never runs;
- unbracketed 64–512-character chunks with 5–10 ms pauses: runs.

## Goals / Non-Goals

**Goals:**

- `/goal` launch and resume text is run by Claude Code as a command.
- One write path for typed input, shared with `write_terminal`.

**Non-Goals:**

- Changing `write_terminal`, `run_command`, or window messages. Long
  `write_terminal` text has the same paste detection, but its callers choose
  what to type; that is a separate change if wanted.
- Detecting the foreground program.

## Decisions

**Type in 128-character chunks, 10 ms apart, never bracketed.**
`writeSeparatedInput` gains `typeChunkChars`; when set, the body is split into
chunks of at most that many characters, by code point so no surrogate pair is
split, and written with `typeDelayMs` (default 10 ms) between chunks, inside
the same per-terminal queue and abort checks as every other write, then each
key after `delayMs` (50 ms). 128/10 sits at a quarter of the largest passing
chunk and twice the smallest passing pause. A 16 KiB launch text (the bound)
takes about 1.3 s; the largest a valid template produces (8 KiB opening
prompt plus the instruction) about 0.7 s. Without `typeChunkChars` the helper
writes exactly as before, so `write_terminal`, `run_command` and window
messages keep their grouping and timing.

A PTY is a byte stream: the program may split or merge what Terminay writes.
The chunking and pauses make Claude Code see typing, as measured; they do not
guarantee its read sizes. So the writer boundary (chunk sizes, pauses, order)
is unit-tested, and the end-to-end test asserts only what arrives as a whole:
the exact one-line text with no paste marker, then Enter.

**Cancellation.** The workflow `typeText` passes the request's
`context.signal` to `writeSeparatedInput`, which checks it before every
chunk and key. A cancelled launch or resume writes nothing more, not even
Enter, and releases the per-terminal queue; a failed write does the same. Alternatives: typing character by character (16k writes
and 16k events through recording and accepted-write notification, minutes at
any safe pause); typing `/goal ` then pasting the rest (relies on Claude Code
expanding a paste placeholder inside a slash command's argument, untested and
brittle).

**The typed text is one line.** Without bracketed paste a line feed reaches
the program as a key. In Claude Code it inserts a line break, but a shell with
readline (which enables bracketed paste, so Terminay cannot tell it from an
agent) runs each line as a command. Line breaks and tabs, with the whitespace
around them, become one space, as the unbracketed path already did. The agent
loses paragraph breaks, not words. `typedWorkflowGoal` in `@terminay/protocol`
composes and flattens, so the server and the template editor's preview agree.

**Boundaries.** No boundary moves. The text is still built server-side from
the stored opening prompt and fixed words (ADR-0097), authorised against the
target terminal session with `write` scope, and written through
`terminalInputSources.write` with source `workflow`; only the grouping of the
bytes changes. The 16 KiB bound applies to the composed text before
flattening, so flattening only shortens it and a text that fits only after
flattening is still refused. Flattening does not normalise Unicode; the
characters typed are the characters stored.

**Ordering with `agent-safe-terminal-submit`.** That change is merged but not
yet archived, and its `terminal-workflows` delta still says "one paste". This
change rewrites that delta to say "typed", so the two agree whichever is
archived first; neither modifies a requirement the other adds.

## Risks / Trade-offs

- [Claude Code changes its paste heuristic] → the evidence probe re-runs in a
  minute; the chunk size and pause are constants in one place.
- [Typing takes up to ~1.3 s, and other input can land between chunks] →
  the per-terminal queue orders it against every other Terminay submission
  (`write_terminal`, `run_command`, window messages, another launch), so
  those never interleave with it. Keys the user types in that window, and
  output-driven replies, reach the PTY directly and can land between chunks,
  as they could with a person typing; Terminay does not lock the keyboard.
  The user starts the launch from the Command Bar and is not typing into the
  terminal at that moment. A closed terminal fails the next write, which
  stops the rest.
- [Claude Code limits a goal to 4,000 characters] → measured: a typed
  launch text over that runs `/goal` and Claude Code refuses the length. A
  template's opening prompt may be up to 8 KiB, so a long one cannot become a
  Claude Code goal. Out of scope here; this change makes `/goal` run, and
  Claude Code then says why it refused, which the user can see.
- [Each chunk is a separate input event] → at most 128 events for a maximal
  launch text, the same order as a user typing.
