## Why

A notification for the terminal the user last typed in is thrown away. The
workspace treats a terminal as "the one the user is interacting with" while it
is the terminal they last clicked or typed in and the focused terminal, and
acknowledges on arrival whatever is raised for it. Nothing asks whether the
user is still there. So the most common use of a notification fails: start an
agent, switch to a browser or walk away, and its finish is acknowledged as
though it had been watched. Nothing reaches the header, the Dock badge, or a
paired phone. A notification a process sends with `send_notification` is lost
the same way.

Whether a user is watching an agent cannot be inferred reliably, and a lost
notification costs more than a redundant one. A plain shell is different: it
reports a command as finished two seconds after the user types it and rings
its bell at them as they type, and telling a user at the keyboard about that
is noise.

## What Changes

- An agent's terminal is never acknowledged because of where the user is. Its
  finished, waiting, and blocked states show and are published after the
  settle period until the user does something in that terminal.
- A notification a process sends is never suppressed because of where the user
  is. It is published after the settle period unless the user acts first.
- A terminal's indicators and notifications are cleared by the user clicking
  its tab, clicking into it, typing into it, moving focus to it with a
  terminal navigation command, or dismissing its notification. Focus that
  lands in a terminal on its own, as when the window returns to the front or
  its project is activated, clears nothing. Neither does moving the mouse.
- A plain shell's own finished or attention activity, in a terminal no agent
  owns, is still acknowledged on arrival for the terminal the user is
  interacting with, and that now requires the window showing it to have focus.
  Leaving for another application ends it, and coming back does not
  acknowledge what arrived meanwhile.
- That acknowledgement is passive: `activity.acknowledge` gains an optional
  `passive` flag, which clears the terminal's activity and leaves what a
  process sent to it.
- **BREAKING** (wire): the `notifications.probe` event is removed. It existed
  only so a client could suppress a sent notification on arrival.
  `notifications.v1` has not shipped in a stable release, and a client that
  still listens for the event simply never hears it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: the "already interacting" case is limited to
  terminals no agent owns, requires window focus, and is passive.
- `agent-status-and-sidebar`: an agent transition on the terminal the user is
  in is unread until they interact with it.
- `workspace-and-project-tabs`: the project activity dot follows the same rule.

The `notification-manager` capability is introduced by the
`server-notification-manager` change, which is implemented and not yet
archived. Its specification is corrected in place: the sentence and scenario
that had a sent notification suppressed for a user already in the terminal,
and the `notifications.probe` requirement, are replaced by this rule. Its
design decision D6 (the probe) is superseded by this change.

## Impact

- `src/App.tsx`, `src/workspace/terminalActivityAcknowledgement.ts` — the
  arrival-time acknowledgement excludes agent terminals, asks the window's
  focus, and is sent as passive. The probe answer is removed.
- `packages/server-core/src/activity/` — `activity.acknowledge` accepts
  `passive`, which is not reported as interaction.
- `packages/server-core/src/notifications/` — the probe event and the
  manager's sent-listener are removed.
- `packages/client-core` — `acknowledge` takes `passive`; `onProbe` is removed.
- Tests: `scripts/terminal-activity-acknowledgement.test.mjs`,
  `packages/server-core/test/notification-protocol.test.mjs`,
  `e2e/terminal-signals.spec.ts`.
- Leaving a project still folds its active shell's late fallback output into
  the viewing acknowledgement at handoff. That requirement is unchanged.
