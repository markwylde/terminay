## Context

A server-backed terminal panel sends what xterm emits through
`ServerTerminalInputQueue`, one write in flight at a time so later input never
overtakes earlier input. The panel replaced that queue on every attach:
`attachServerTerminal`, `prepareRecovery`, and the connection rebind each
called `close()`, which discards everything not yet sent, and only the next
`attachServerTerminal` made a fresh one.

Two windows lost input:

1. **Congestion recovery.** A recoverable skip runs `prepareRecovery`, which
   closed the queue, then waits `TERMINAL_RECOVERY_RETRY_DELAY_MS` before it
   resumes. Every key typed in that delay went to a closed queue and was
   dropped, and every key queued behind the write in flight was discarded.
2. **Before a presentation is known.** `writePanelInput` dropped input whenever
   `terminalPresentationControllerRef` was false, which is also the state of a
   panel whose first attach has not answered yet.

The interactive presentation lease is the boundary here: only its holder may
write to the PTY, and the server enforces it on every `terminal.input`. Nothing
in this change moves that check or weakens it.

## Goals / Non-Goals

**Goals:**

- No input typed into a focused panel is silently discarded because the panel
  is replacing its own attachment.
- Held input reaches the PTY in order and exactly once, or — when a write's
  outcome is unknown — at most once.

**Non-Goals:**

- Holding input across a takeover from another device. Until the takeover
  answers, another attachment holds the lease and may be answering the same
  terminal queries; queuing this panel's emulator replies then would send
  them twice. A read-only observer keeps refusing input, and its control bar
  keeps saying why.
- Changing how a write with an unknown outcome on the current attachment
  fails: the queue still closes and the panel shows its error and Retry.

## Decisions

### The queue belongs to the mounted panel

The panel makes one queue when it first attaches and keeps it until a
transport failure or disposal closes it. Recovery, rebind, and every re-attach
call `handoff()`: the old attachment is dropped, a generation is advanced, and
the queue's role becomes `pending`. Items stay. Input keeps being accepted.
`attach()` binds the replacement once it has hydrated, as before.

Alternative considered: keep a queue per attachment and copy unsent items into
the next one. That needs the panel to know which item is in flight, and loses
the single pump that is what keeps the order.

### The presentation role decides, in the queue

`applyPresentation` calls `setPresentationRole(role)` for the current
attachment. `controller` lets the pump write; `read_only` discards what is
queued and refuses further input. `pending` (after a handoff) accepts and
holds. The renderer's `terminalPresentationControllerRef` still drives resize
and viewport ownership, but no longer gates input.

### A write in flight on a replaced attachment settles where it was sent

The pump awaits the write it already started. When it settles after a handoff:

- success: it was delivered; the next item goes to the replacement;
- a server or client refusal (for example `session_not_found` for an
  attachment the server already replaced, or the attachment-closed refusal
  before sending): it never reached the PTY, so it stays first and the
  replacement sends it once;
- `unknown_command_outcome` or an unreadable reply: it may be in the PTY, so it
  is treated as delivered and never sent again.

An error on the *current* attachment keeps its existing meaning: an ownership
refusal discards the stale queue; anything else closes the queue and fails the
panel visibly.

## Risks / Trade-offs

- [A write whose outcome is unknown, on an attachment already replaced, may
  not have reached the PTY, and later input still follows it] → This is the
  rebind-after-transport-loss case. Before this change the later input was
  discarded silently; now at most the one uncertain write can be missing and
  everything typed after it arrives. The current-attachment case still fails
  closed.
- [Input typed while a fresh panel attaches is delivered later than typed] →
  It is delivered in order once the panel holds control, which is what a
  local terminal does with type-ahead.

## Testing

- `scripts/terminal-panel-input-queue.test.mjs` drives the queue through a
  handoff with writes the test settles: queued and newly typed input reaches
  the replacement once and in order; a refused in-flight write is resent once;
  an unknown-outcome one is not; a read-only replacement refuses; a paste
  resumes from its first unsent chunk.
- `e2e/terminal-input-handoff.spec.ts` holds the first key's write at the
  embedded server, ends the stream as congested, keeps typing through the
  recovery, and asserts the PTY received every key once and in order. The
  seam is `electron/testTerminalHandoff.ts`, installed only under
  `TERMINAY_TEST=1`; it wraps the embedded server's `TerminalService` and
  touches neither the protocol nor the renderer.
