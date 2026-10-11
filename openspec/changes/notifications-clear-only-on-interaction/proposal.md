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

Guessing whether the user is watching cannot be made reliable, and a lost
notification costs more than a redundant one. The rule becomes one the user
can predict: a notification clears when they do something in that terminal,
and for no other reason.

## What Changes

- Nothing is acknowledged because of where the user is when it arrives.
  Completion, attention, and a sent notification for the focused terminal show
  their indicator and are published after the settle period like any other.
- A terminal's indicators and notifications clear only when the user clicks
  its tab, clicks into it, types into it, moves focus to it with a terminal
  navigation command, or dismisses its notification.
- Focus that lands in a terminal without the user acting on it, as when the
  window returns to the front or its project is activated, does not clear
  anything. Neither does moving the mouse over it.
- The settle period is what keeps this quiet: a user who is at the terminal
  and types or clicks within it never sees the notification published.
- **BREAKING** (wire): the `notifications.probe` event is removed. It existed
  only so a client could acknowledge on arrival. `notifications.v1` has not
  shipped in a stable release, and a client that still listens for the event
  simply never hears it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-activity-signals`: fallback acknowledgement no longer has an
  "already interacting" case.
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

- `src/App.tsx` — the arrival-time acknowledgement in the activity snapshot
  path, the probe answer, and the "last interacted terminal" state are removed.
- `src/workspace/terminalActivityAcknowledgement.ts` and its test — removed.
- `packages/server-core/src/notifications/` — the probe event and the
  manager's sent-listener are removed.
- `packages/client-core/src/notificationsClient.ts` — `onProbe` is removed.
- Tests: `packages/server-core/test/notification-protocol.test.mjs`,
  `e2e/terminal-signals.spec.ts`.
- Leaving a project still folds its active shell's late fallback output into
  the viewing acknowledgement at handoff. That requirement is unchanged.
