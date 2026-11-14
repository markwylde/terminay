## Why

A remote server learns of a newer release only from its own check: at start,
on an attach after an hour, and hourly while a client is attached. Someone who
knows a Canary build was just published has no way to make the server look.
The server's Updates page reads "Up to date" on a stale answer, the connection
menu shows nothing at all for a server with no upgrade on offer, and **Upgrade
server…** stays absent for up to an hour. Terminay Desktop has **Check for
updates**; the server it is connected to has nothing.

## What Changes

- A paired device may ask a server to check its release channel now with
  `server.upgrade.check`. The request carries nothing. The server reads its
  channel, publishes the resulting status to every attached client, and replies
  with it. A check already running is shared, a request within ten seconds of a
  good check answers from it, and a check that cannot read the channel is
  refused with `check-failed` rather than answered with stale news.
- The connection menu, wide and compact, keeps a row for every attached server
  that has an upgrader, even with nothing on offer. The row says the version it
  runs and offers **Check for updates**, then says what the check found:
  "Up to date · <version>", "Update available · <version>" (with **Upgrade
  server…** beside it), or why it could not check.
- A server's Updates page in Settings gains **Check for updates** under its
  release track, with the same result line.
- A server that predates the request is told apart: the client says it is too
  old to check on request and checks by itself every hour.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-upgrade`: a paired device may ask for a release check now.
- `connections-and-client-hosts`: the connection menu and a server's Updates
  page offer **Check for updates** for each server with an upgrader.

## Impact

- `packages/protocol`, `packages/server-core`, `packages/client-core`: the
  `server.upgrade.check` operation, its service method, and its client call.
- `src/workspace/ServerUpgradeMenuRows.tsx`, `serverUpgradeModel.ts`,
  `useServerUpgrades.ts`, `SettingsServerUpdates.tsx`,
  `src/components/settings/UpdatesPages.tsx`, `src/App.tsx`: the actions.
- No new poll. Each check is one a person asked for.
