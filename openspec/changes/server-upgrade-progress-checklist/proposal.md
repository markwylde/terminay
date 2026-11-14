## Why

When someone chooses **Upgrade server…** and confirms, the window drops and
reconnects several times while the server installs and restarts. Each drop
looks like a fault: the workspace dims behind "Terminal stream stalled.
Reconnecting…", the connection menu flips to "Reconnecting…", and the only
sign that this is the upgrade they asked for is a small "Upgrading…" line in
a menu that is usually closed. The disconnects are expected; the window should
present them as steps of one upgrade, not as a run of connection errors.

## What Changes

- Once the server accepts, the confirmation is replaced by a small progress
  card for the window's server with a ticklist of the upgrade's steps: the
  request accepted, the new release installing, the server restarting (and the
  connection with it), and the server back on the new version. Each step shows
  waiting, running, done, or failed.
- While the connection to a server whose upgrade this window follows is down,
  that ticklist is what the window shows in place of the reconnecting overlay's
  stall or connection-lost text. Being disconnected is shown as the
  "Restarting" step running, not as an error.
- The connection menu's row for that server shows the step that is running,
  not a bare "Upgrading…", and the connection's status reads
  "Restarting for upgrade…" while it is down for a followed upgrade, not
  "Reconnecting…".
- The card ends on the outcome: every step ticked and the new version named,
  or the failed step marked with why: a rollback, still on the old version, no
  report of the outcome, an incompatible server, or a server that did not come
  back. The device that started the upgrade keeps that final state until the
  person closes it. The existing Notifications entries for the outcome are
  unchanged.
- The card is centred and modal over the whole window for the whole upgrade,
  on every device following it, and never moves when the connection drops or
  returns: there is nothing useful to do in that window meanwhile. An attached
  server that is not the window's own shows the running step in its menu row
  only.
- The steps come from what the window already sees: the start reply, the
  server's published upgrade status, and the connection's phase. The protocol
  and the server are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: the requirement "Confirming and following a
  server upgrade" (added by the in-flight change `remote-server-in-app-upgrade`)
  replaces "the connection's drop and return SHALL use the ordinary
  reconnecting presentation" with the progress ticklist, and gains scenarios
  for the steps, the modal card, reload, observers, and each
  ending.

## Impact

- `src/workspace/serverUpgradeModel.ts`: the board derives each followed
  upgrade's steps and remembers which device started it.
- `src/workspace/useServerUpgrades.ts`, `ServerUpgradeDialog.tsx`,
  `ServerUpgradeMenuRows.tsx`, `ConnectionsControl.tsx`: the board is taken from
  a provider; the menu row and status name the running step.
- New `src/workspace/ServerUpgradeBoardHost.tsx` and
  `src/workspace/ServerUpgradeProgress.tsx`: the board's owner, and the card.
- `src/web/main.tsx`: mounts the board host inside `ConnectionsProvider`,
  because the workspace remounts on every reconnect, and lets it draw the card
  in place of the reconnecting text.
- Unit tests in `src/workspace/serverUpgradeModel.test.ts`; e2e coverage in
  `e2e/server-upgrade.spec.ts`.
- Depends on `remote-server-in-app-upgrade` being archived first, since the
  requirement it modifies is introduced there.
