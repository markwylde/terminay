## Why

Open a second window on the same remote server and the first one drops to "reconnecting". It happens with two browser tabs, with two Terminay Desktop windows, and it would happen when a Desktop window on a remote server opened Settings, Macros, Recordings, or Remote Control, each of which is its own window. A Terminay Server keeps one live connection per device and treats every new one as a replacement for the last.

That rule was written to clear away the dead connection a reconnect leaves behind, and it does that. But it cannot tell a window reconnecting from a second window opening, so it closes both. Local has no such rule, which is why several Desktop windows work on Local and nowhere else. `one-window-one-server` makes a Desktop window on a remote server an ordinary thing, and it cannot ship while that window's own Settings would disconnect it.

## What Changes

- **A server holds one live connection per client window, not per device.** Each browser tab and each Desktop window is its own connection, as Local windows already are.
- **A window names itself when it authenticates.** It sends a random window id, the same one for as long as that window lives, on the authenticated channel beside its connection ticket. A reconnect from a window replaces that window's previous connection and no other.
- **A window is its own client to the workspace.** Terminal attachments, input, display leases, and checkpoints of one window never collide with another window of the same device, so two windows can show the same terminal the way two devices can.
- **Device identity keeps its job.** Authentication, permissions, approval, and revocation are per device. **BREAKING** for anyone relying on a new connection closing the old: revoking a device now closes every window it has open, and nothing else closes them.
- **A device is capped at eight live windows per server.** A ninth is refused with a reason the person sees; it does not push another out.
- **A client that sends no window id behaves as today.** Every such connection from a device counts as one window, so an older client or relay keeps the old takeover behaviour and nothing breaks during rollout.
- **Live connections are listed per device**, with the number of windows, where they were one row per connection.
- **The "remote device connected" automation trigger fires when a device's first window connects**, not once per window.
- **Desktop opens one connection at a time to a given server**, so two of its windows connecting together do not cancel each other's handshake.

Not in this change: making two windows' handshakes distinguishable to the signaling relay. They remain one at a time per device, as the spec already requires; a browser restoring several tabs at once connects them one after another.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `remote-access`: one live connection per client window replaces one per device; revocation closes every window of the device; a per-device window cap; live connections are presented per device.
- `automations`: the remote-device-connected trigger fires on a device's first live window.

## Impact

- **Server:** `apps/terminay-server/src/remote/hostedPairingHost.ts` and `hostedPeerLifecycle.ts` (the live-peer registry, replacement, revocation, the cap); `packages/server-core/src/remote/deviceAuthentication.ts` (the ticket carries no window id; the window id arrives with `application-auth`); `packages/server-core/src/connection.ts` and the terminal, input, presentation, and checkpoint services, which key on the client identity.
- **Desktop:** `electron/remote/desktopHostedConnection.ts` and `electron/main.ts` send a window id per native window and open one connection at a time per server; `electron/remote/serverOwnedExposure.ts` and the live-connections lists in `src/` group by device.
- **Browser client:** the session-origin client that sends `application-auth` lives in the `terminay.com` repository. Until it sends a window id, browser tabs keep today's takeover. That change is part of this work, in that repository.
- **Signaling relays:** unchanged. The window id never passes through a relay.
- **Operators:** each live window takes UDP ports from a pinned ICE range where one is configured. The standalone installer's default span of four serves about two windows at once; the container image's sixteen serves about eight. The runbook says so. Defaults are not changed here.
- **`one-window-one-server`:** depends on this change. Its limits of one window per remote server and no tear-off on a remote window are removed from its specs.
