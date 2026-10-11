# ADR-0061: A notification is a server-owned record that its terminal adds and removes, published after a settle period

Status: accepted
Date: 2026-10-11

## Context

Terminay Server holds each terminal's activity state, and every client has
derived its own notifications from it: which terminals count, what to call
them, and how many there are. A notification was a view, not a thing. It had no
identity, could carry no text of its own, and there was no single point at
which the product decided whether a person should be told yet.

Two needs made that untenable. A notification should not flash into the header
and the application icon and vanish again a moment later because an agent
paused or the user was already reaching for the terminal. And notifications are
about to appear in more places, a phone among them, each of which would have
had to reimplement the derivation and agree with the others.

ADR-0058 already says a fact taken from terminal output is live server state.
ADR-0031 and ADR-0037 already put every agent-facing operation behind one
server-owned control endpoint with a per-terminal capability.

## Decision

1. **A notification is a record held by one notification manager on the
   server.** It belongs to exactly one terminal, and the server resolves that
   owner. Nothing else in the product decides what a notification is.
2. **A terminal adds and removes its notifications, and that is all it does.**
   Terminal activity and processes calling the control endpoint are the only
   sources. They carry no timing, publication, or delivery logic.
3. **A notification is published only after it has stayed present for a settle
   period.** It is held as pending from the moment it is added, so it can be
   removed at any time; one removed while pending is never shown to anyone.
   Removal of a published notification is immediate.
4. **Every consumer shows what the manager has published.** Clients do not
   derive notifications. A new surface is one more reader of the published set.
5. **Status indicators are not notifications.** A terminal's and a project's
   indicator show live state without delay.
6. **Interaction with a terminal removes all of its notifications**, whatever
   added them.
7. **Text a process supplies is bounded plain text** that selects nothing, and a
   notification is always shown with its server-resolved terminal and project.
8. **Notifications are live state and are not persisted.**

## Rejected alternatives

- **Keep deriving on each client and add a delay to each.** Every client would
  need the same timer and the same rule, and a phone has no client running to
  apply either.
- **Delay only delivery to remote devices.** It leaves the header and the
  application icon flashing, and makes the phone disagree with the desktop.
- **Treat a change of kind as a removal and a new notification.** Every state
  change would restart the settle period and a continuing event would flicker.
- **Take notification text from OSC sequences.** Any program writing to a
  terminal could then put words in front of the user under Terminay's name.
  Text comes only from an explicit call through the terminal's capability.

## Consequences

- The header Notifications count and list and the Desktop application icon badge
  show a notification a few seconds after it arises. Tab and project indicators
  are unchanged.
- Clients render a second server projection beside terminal activity. The rule
  that builds the notification list remains in the workspace UI only for a
  server that does not advertise the capability.
- Sending a notification changes no terminal indicator. An agent's terminal
  takes its indicator from agent status alone.
- An agent can send and dismiss a notification on its own terminal. It cannot
  see or remove another terminal's, or its own terminal's activity notification.
- Any future policy about when to tell a person, such as holding longer while
  they are active, has exactly one place to live.
- A notification a process sent does not survive a server restart.

## Open items

- Whether the settle period should be longer while a client is in active use on
  the server.
- Whether a notification a process sent should be restored with its terminal
  once terminals survive a restart.
