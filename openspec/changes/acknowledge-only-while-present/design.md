## Context

Two client paths acknowledge on arrival: the activity snapshot path, for
finished and attention activity, and the answer to `notifications.probe`, for
a notification a process sent. Both compared the last interacted terminal and
the focused terminal with the terminal in question. Neither value changes when
the operating-system window loses focus, so a user in another application was
still "in" the terminal they had typed in.

## Goals / Non-Goals

- Goal: a user who is not in the Terminay window is in no terminal.
- Goal: one definition, used by both paths.
- Non-goal: any change to what the server holds or to the wire protocol.
- Non-goal: a longer settle period while the user is at their desk.

## Decisions

- **Ask the window at the moment of arrival.** The definition takes whether
  the document that shows the terminal has focus, read when the activity or
  probe arrives. The alternative, clearing the interacted terminal when the
  window blurs, loses the interaction for good: a user who looks away and
  comes back to the same terminal would no longer be in it until they typed
  again, and a terminal in a window of its own would be cleared by the main
  window's blur while it is being typed in.
- **Judge a terminal by its own window.** A terminal moved to a window of its
  own is asked through the document its panel is in.
- **Returning is not acknowledgement.** What arrived while the user was away
  stays until they click or type, as activating a project already leaves it.

## Risks / Trade-offs

- [A user who can see the terminal on a second monitor while working in
  another application is now notified] → That is the intended reading: the
  product cannot tell watching from not watching, and a missed notification
  costs more than a redundant one.
- [Automated browsers report focus always] → The end-to-end test tells the
  page it has no focus; the rule itself is covered by unit tests.

## Migration Plan

None. Client-only; rolls back by reverting.

## Open Questions

None.
