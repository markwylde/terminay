## Why

Keystrokes typed into a focused terminal can vanish. A terminal that keeps
its place on screen still replaces its attachment to the server from time to
time — when its stream falls behind and recovers, when a resume is refused,
or when its window's connection is replaced. Anything typed in that moment,
and anything typed a moment before that had not been sent yet, is silently
thrown away: `git worktree add` reaches the shell as `gktree add`, and
`read _ < 'gate'` as `rea< 'gate'`. Nothing on screen says input was lost, and
the shell runs some other command. The end-to-end suite has been retyping
commands to hide it; users get no such retry.

The terminal-workspace spec says who may write to a PTY (the presentation
lease holder) and what happens when control is taken away (the queue is
discarded and the observer's bar says so). It says nothing about a terminal
replacing its *own* attachment, and the panel treats that like a failure.

## What Changes

- Input belongs to the mounted terminal panel, not to one attachment. When the
  panel replaces its attachment, input already queued and input typed while
  the replacement attaches is held, then delivered to the PTY in the order it
  was typed, once each, when the replacement holds the presentation lease.
- A write already in flight on the attachment being replaced settles first,
  so nothing overtakes it. If the server refused it before the PTY, the
  replacement sends it once; if its outcome is unknown, it is never sent
  again.
- Input typed before a panel's first attachment has reported its presentation
  is held the same way rather than dropped.
- Unchanged: a read-only observer refuses input, and its control bar says
  another attachment holds control; a write that fails with an unknown outcome
  on the current attachment still fails the terminal closed with its visible
  error and Retry.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `terminal-workspace`: adds the requirement that a panel's own attachment
  handoff never discards input.

## Impact

- `src/components/terminalPanelInputQueue.ts` — the queue gains a handoff and
  a presentation role, and settles a write in flight on a replaced attachment.
- `src/components/TerminalPanel.tsx` — one queue per mounted panel; recovery,
  rebind, and re-attach hand it off instead of closing it; the presentation
  role, not a renderer flag, decides whether input is accepted.
- `electron/testTerminalHandoff.ts` — an E2E-only seam, installed only under
  `TERMINAY_TEST=1`, that holds a terminal's writes and ends its stream as
  congested.
- `e2e/support/terminal-input.ts` — `runShellCommand` no longer retypes a
  command whose keys went missing.
- No protocol, server, or preload change.
