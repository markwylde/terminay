# ADR-0104: A notification is acknowledged only by what the user does

Status: accepted
Date: 2026-11-11

## Context

ADR-0061 and ADR-0100 make every notification a server-owned record that a
client removes by acknowledging it. They do not say what entitles a client to
acknowledge. Clients answered that differently. Agent terminals were changed
(`notifications-clear-only-on-interaction`) to clear only on a user action,
because a terminal being focused or on screen says nothing about whether the
user saw what happened in it. Bot Chat still acknowledged whenever it was on
screen, so a bot's reply that arrived while the user was in another
application was cleared before its settle period ended and never reached the
header, the Home counts, or the Dock badge.

Whether a user is watching cannot be inferred reliably. A notification that is
lost costs more than one that turns out to be redundant.

## Decision

1. **A client acknowledges a notification only because of something the user
   did** with its owner: selecting or opening it, clicking or pressing a key
   inside it, sending to it, or dismissing the notification.
2. **Presence is never acknowledgement.** An owner being visible, focused, in
   front, restored, or brought forward by the window or app returning to the
   front acknowledges nothing. Neither does something arriving while it is
   visible. Neither does scrolling or pointer movement.
3. The one exception is passive: a plain shell's own finished or bell
   activity in the terminal the user is typing in, in a focused window, as
   `notifications-clear-only-on-interaction` defines. It never clears what a
   process or an agent sent.

## Consequences

- A user who is watching an agent or a bot sees a notification for a result
  unless they act on it within the settle period.
- A new notification owner defines which user actions acknowledge it, and
  does not acknowledge on visibility.
