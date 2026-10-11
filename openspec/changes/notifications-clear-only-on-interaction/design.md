## Context

Two client paths acknowledged on arrival. The activity snapshot path treated
finished and attention activity as viewed when it arrived for the terminal the
user had last clicked or typed in, if that terminal was still the focused one.
The answer to `notifications.probe` did the same for a notification a process
sent. Neither value changes when the user goes to another application or
leaves the desk, so the terminal a user had just prompted an agent in was the
one terminal that could never notify them.

A first attempt added the window's focus to the definition. It repaired the
case of another application and left the rest: a user who has walked away from
a focused window, and the need to decide what a return to the window means.
The owner chose the simpler rule this change records.

## Goals / Non-Goals

- Goal: a notification is never cleared by an inference about attention.
- Goal: the clearing rule can be stated in one sentence and is the same for
  fallback activity, agent status, and sent notifications.
- Non-goal: any change to the settle period, to what the server holds, or to
  push.
- Non-goal: the project-switch handoff acknowledgement for an unclaimed shell.

## Decisions

- **Nothing is acknowledged on arrival.** The snapshot path renders what the
  server says. Alternative considered: keep the shortcut and require window
  focus. Rejected because presence at a focused window is still a guess.
- **The clearing acts are the existing ones.** Clicking the tab, clicking into
  the terminal, typing, a terminal navigation command, and dismissal already
  report the server-owned acknowledgement. Nothing new is reported.
- **Automatic focus is not an act.** The terminal-focused announcement, which
  fires when the window returns or a project is activated, updates which
  terminal is focused and acknowledges nothing, as before.
- **Mouse movement does not clear.** It was considered as a sign of presence.
  In a split layout the pointer crosses terminals on its way elsewhere and
  would clear notifications nobody read.
- **The probe is removed, not left unanswered.** With no client answering it,
  the event, the manager's sent-listener, and the client method are dead code
  on a security-relevant surface.

## Risks / Trade-offs

- [A user watching a terminal finish, hands off, is notified five seconds
  later] → Accepted by the owner. The settle period absorbs the case where
  they act; the remaining case errs towards telling them.
- [A bell from the shell the user is typing in becomes a notification if they
  then stop for the whole settle period] → Same trade; the next keystroke
  clears it.
- [End-to-end tests that relied on the focused terminal staying clear] →
  Rewritten to state the new rule.

## Migration Plan

None. Rolls back by reverting. An older client connected to a newer server
never receives a probe and so acknowledges nothing on arrival for sent
notifications; an older server's probe is ignored by a newer client.

## Open Questions

None.
