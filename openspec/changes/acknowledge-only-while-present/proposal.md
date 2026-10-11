## Why

A notification raised for the terminal the user last typed in is thrown away
when they have left Terminay for another application. The workspace treats a
terminal as the one the user is interacting with while it is the terminal they
last clicked or typed in and the focused terminal, and it asks nothing about
the window. So the most common use of a notification fails: start an agent,
switch to a browser, and its finish is acknowledged on arrival as though it had
been watched. Nothing reaches the header, the Dock badge, or a paired phone.
The same holds for a notification a process sends with `send_notification`.

## What Changes

- A terminal counts as the one the user is interacting with only while the
  window showing it has focus, as well as being the terminal they last clicked
  or typed in and the focused terminal.
- Completion, attention, and a sent notification that arrive for that terminal
  after the user has gone to another application are kept: they show their
  indicator and are published after the settle period like any other.
- Coming back to the window does not acknowledge what arrived meanwhile.
  Clicking the tab, clicking into the terminal, or typing still does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: the definition of the terminal the user is
  interacting with gains the window's focus.

## Impact

- `src/workspace/terminalActivityAcknowledgement.ts` — the one definition of
  interacting, now used by both acknowledgement paths.
- `src/App.tsx` — the activity snapshot path and the `notifications.probe`
  answer pass whether the terminal's window has focus.
- Tests: `scripts/terminal-activity-acknowledgement.test.mjs`,
  `e2e/terminal-signals.spec.ts`.
- No server, protocol, or persistence change. The agent-status and
  notification-manager requirements refer to the terminal the user is
  interacting with and take the corrected meaning without a change of text.
