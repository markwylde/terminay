## Context

Two client paths acknowledged on arrival. The activity snapshot path treated
finished and attention activity as viewed when it arrived for the terminal the
user had last clicked or typed in, if that terminal was still the focused one.
The answer to `notifications.probe` did the same for a notification a process
sent. Neither value changes when the user goes to another application or
leaves the desk, so the terminal a user had just prompted an agent in was the
one terminal that could never notify them.

Removing the shortcut outright was tried and measured. The activity reducer
reports a plain shell as finished two seconds after input goes quiet, so every
command a user typed and then read for a few seconds became a Dock badge and a
phone banner. The owner chose to keep a plain shell quiet for a user who is
there, and to make agents and sent notifications strict.

## Goals / Non-Goals

- Goal: an agent's state and a sent notification are never cleared by an
  inference about attention.
- Goal: a user typing shell commands is not notified about them while they
  are at that terminal, and is when they have left.
- Non-goal: any change to the settle period, to the reducer's rules for what
  counts as finished, or to push.
- Non-goal: the project-switch handoff acknowledgement for an unclaimed shell.

## Decisions

- **Agent terminals are excluded by the snapshot's `claimed` flag.** The
  server already says whether a provider owns a terminal's activity. The
  client applies the shortcut only where it is false.
- **Interacting requires the window's focus, asked at arrival.** The document
  that shows the terminal is asked when the activity arrives, so a terminal
  in a window of its own is judged by that window. Clearing the interaction
  on window blur was rejected: the main window's blur would clear a terminal
  being typed in elsewhere.
- **Arrival while away ends the interaction.** Otherwise the next activity
  event after the user returned would acknowledge what they never saw.
- **The shortcut's acknowledgement is passive.** An ordinary acknowledgement
  is reported to the notification manager as interaction and removes what a
  process sent. A user who did nothing has not seen that, so
  `activity.acknowledge` takes `passive`, which clears the reducer's state and
  is not reported as interaction. An older server ignores the flag and treats
  it as an ordinary acknowledgement.
- **The probe is removed, not left unanswered.** With no client answering it,
  the event, the manager's sent-listener, and the client method are dead code
  on a security-relevant surface.
- **Mouse movement does not clear.** In a split layout the pointer crosses
  terminals on its way elsewhere and would clear notifications nobody read.

## Risks / Trade-offs

- [A user watching an agent finish, hands off, is notified after the settle
  period] → Accepted by the owner; typing or clicking within it prevents it.
- [A user who walks away from a focused Terminay window is still treated as
  at their shell] → Applies to plain shell activity only. Agents and sent
  notifications, the cases that matter when away, are not affected.
- [Automated browsers always report focus] → The end-to-end test tells the
  page it has none; the definition is covered by unit tests.

## Migration Plan

None. The change is undone by reverting its commits.

## Open Questions

None.
