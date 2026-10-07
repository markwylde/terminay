# One live connection per device, and what it means for Desktop windows

Date: 2026-10-07. Method: reading the server and the specification. Not yet
exercised by running two windows; the Electron E2E for task 2.4 does that.

## Question

Can two Terminay Desktop windows show the same remote server at once?

## What the server does

`apps/terminay-server/src/remote/hostedPeerLifecycle.ts` keeps live peers in
`HostedLivePeerRegistry`, a map keyed by device id: "At most one live peer per
device." When a device that already has a live peer joins again and its
replacement authenticates and consumes a ticket, the registry's `close(deviceId)`
closes the previous peer and awaits its server-side cleanup before the
replacement is attached.

`openspec/specs/remote-access/spec.md`, "One live connection per device",
states the same contract: each server holds at most one live connection per
device, and a rejoin replaces the previous peer. Its scenario "Second tab takes
over" describes the visible result for a browser: the first tab shows
reconnecting.

## What Desktop does

Desktop enrols one device key per server origin and stores it in
`DesktopDeviceCredentialStore`. Every transport Desktop opens to that origin
authenticates as that one device, whichever window asked for it.

## Conclusion

Two Desktop windows on the same remote server would each be the same device to
that server. The second would replace the first, the first's recovery loop
would reconnect and replace the second, and the two would take the connection
from each other in turn.

So on Desktop a remote server is shown by at most one window. Local is
different: its windows connect over private in-process ports, not as an
enrolled device, and several may show Local at once.

## Consequences taken in `one-window-one-server`

- Choosing a remote server that another window already shows focuses that
  window.
- **Open in new window** for such a server focuses that window too.
- A project cannot be torn out of a window showing a remote server, because
  the new window would be a second connection from the same device. Tear-off
  stays available on Local.

Lifting this would need either a device identity per window or one transport
shared between windows in the host. Neither is in scope.
