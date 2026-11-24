## Context

`ServerUpgradeService.check()` already reads the channel through the
release's own upgrader, shares concurrent runs, and never rejects. Clients see
the outcome only through the `server.upgrade` status event.

## Decisions

1. **A command, not a query.** `server.upgrade.check` makes the server reach
   the network, so it is a command at `admin` scope, the paired device's, like
   `server.upgrade.start`. Its payload is empty; anything else is a validation
   error.
2. **The reply is the check's own status.** The command awaits the check and
   replies with the status it produced, so the person sees the answer to their
   click, not the previous one. Every other client hears the same status on
   the event as before.
3. **A failed check is refused.** `check()` stays silent for the hourly and
   attach checks. `checkNow()` records whether the last run read the channel
   (an upgrader error, or a report carrying `checkError`) and refuses with
   `unavailable` / `check-failed` when it did not.
4. **A ten-second floor, not a rate limit.** A request within ten seconds of a
   successful check answers from it. Repeated clicks cannot fan out into
   repeated release-metadata requests, and a failed check is never answered
   from.
5. **The menu row exists for every server with an upgrader.** `channel` is
   present on the status exactly when the server has an upgrader, so a row is
   kept whenever it is set. The warning icon is kept for an upgrade on offer
   or a failure; otherwise the row carries a neutral icon.
6. **Older servers.** A server without the operation replies with the
   protocol's unknown-operation error. The client says it is too old to check
   on request. Its hourly check still finds the release that would add it.

## Risks

- The check button is in a menu that stays open on click; the result line is
  announced with `role="status"`.
