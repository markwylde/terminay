## Context

A remote client reaches a Terminay Server like this (`apps/terminay-server/src/remote/hostedPairingHost.ts`):

1. It sends `device-join` through a signaling relay, carrying its `deviceId`, a per-attempt `clientNonce`, and a proof signed with the device key.
2. The host opens a WebRTC peer. While the handshake runs it is held in a slot keyed by `device:<deviceId>`.
3. On the authenticated `api` lane the client answers a challenge and receives a single-use connection ticket bound to that peer.
4. On the `control` lane it sends `application-auth { id, ticket }`. The host consumes the ticket, then calls `replaceDevicePeer(deviceId)`, which closes the device's previous live peer and awaits its cleanup.
5. The host attaches the peer to the workspace with `clientId: ticket.deviceId` and records it in `HostedLivePeerRegistry`, a map keyed by `deviceId`.

Step 4 is where one window closes another. Nothing a client sends says which window it is: `clientNonce` changes on every attempt, and the `client_hello.clientId` the bundle sends is ignored on the remote path because the transport-authenticated identity wins.

Step 5 is a second collision. Server-core keys terminal attachments, input authority, presentation leases, and checkpoints by `clientId`, and on the remote path that is the device id. Two connections of one device attaching the same terminal detach each other (`terminalService/protocol.ts`), regardless of the registry.

Other facts that shape the design:

- The hosted relay is in the `terminay.com` repository. It rebuilds `device-join` from a fixed set of fields, so an extra field would be dropped, and it targets a host's offer at the oldest joined socket of that device. The direct relay in this repository keeps one client slot per plane. Neither can tell two handshakes of one device apart. The spec already requires one handshake at a time per session ("One handshake at a time per room or session").
- A client whose connection is replaced sees an ordinary close and retries on backoff. There is no "opened elsewhere" state. Two visible windows therefore take the connection from each other in turn today.
- The browser client that sends `application-auth` is in `terminay.com`. Desktop's is `electron/remote/desktopHostedConnection.ts`.
- A standalone server runs two pairing hosts, hosted and direct, each with its own registry.
- Revoking a device removes its challenges and tickets. No path was found that closes its live hosted peer.
- There is no cap on live peers on this path. Where an ICE port range is pinned, each live peer takes about two UDP ports from it.

In-force ADRs that bear on this: ADR-0005 and ADR-0011 (trust boundaries), ADR-0013 (device-bound approval; credentials only on transport-authenticated channels; a live peer is replaced only by a peer that has consumed a ticket), ADR-0015 (direct signaling), ADR-0034 (no media relay; the ICE range is a budget), ADR-0041 (liveness deadlines).

## Goals / Non-Goals

**Goals:**

- Several windows of one device connected to one server at once, each independent, as on Local.
- A window's reconnect still clears that window's dead connection, promptly and before the replacement attaches.
- Revocation, permissions, and approval stay per device.
- No change to either signaling relay, and nothing breaks while old and new clients and servers coexist.

**Non-Goals:**

- Distinguishing two handshakes of one device at the relay. They stay one at a time.
- Sharing one transport between windows in the Desktop main process.
- Changing ICE port defaults.
- A per-window identity for approval or revocation.

## Decisions

### 1. The window id travels with `application-auth`

`application-auth` gains an optional `windowId`. It is the first point at which the host both holds an authenticated channel and decides about replacement, so nothing earlier needs to know which window is connecting.

**Boundary:** ADR-0013 allows credentials only on transport-authenticated channels and keeps relays data-blind. The window id is not a credential, but it steers which live peer is closed, so it is accepted only on the authenticated `control` lane beside a ticket that has already been bound to this peer. It never passes through a relay, and a relay cannot forge or observe it.

- *Alternative: a field on `device-join`.* Rejected: the hosted relay drops unknown fields, so it would need a coordinated relay release, and an unauthenticated joiner could name a window.
- *Alternative: derive it from `clientNonce`.* Rejected: the nonce is per attempt and exists to stop replay.
- *Alternative: use `client_hello.clientId`.* Rejected: it arrives after the peer is attached, which is after the replacement decision.

### 2. A window id is random, per window, and carries no authority

A browser tab generates one per document and keeps it in memory, so a reload is a new window and the old connection is closed by the unload or by liveness. Desktop main generates one per native window and keeps it across that window's reloads and reconnects. It is validated as a bounded identifier (the protocol's existing id pattern, at most 64 characters).

The registry key is the pair of device id and window id, so a window id presented by another device names a different entry and can close nothing of anyone else's. Knowing a window id gives no ability beyond what the device's ticket already gives.

### 3. No window id means the device's one unnamed window

An `application-auth` without `windowId` uses the empty window id. Every such connection of a device shares one registry entry and replaces the last, which is today's behaviour exactly. So an old client against a new server, and a new client against an old server (which ignores the field), both behave as now. No version negotiation is needed.

### 4. The registry replaces within a window and closes across a device

`HostedLivePeerRegistry` is keyed by device and window. `replaceDevicePeer` becomes replacement of one window's peer; the per-device ordering chain stays per device, because cleanup of one window must still not interleave with that device's other attaches. The registry also answers "every peer of this device" for revocation, the cap, the live list, and stop.

Revoking a device closes every live peer it has in both pairing hosts. This closes a gap as well as serving the new model: no path was found that closed a live hosted peer on revoke.

### 5. Each window is its own workspace client

On the remote path the host attaches a peer with a client identity made from the device id and the window id, and passes the device id beside it. Server-core's `AuthenticatedClient` carries both: the client identity keys attachments, input authority, presentation leases, checkpoints, and client-addressed events, as it does for two devices today; the device id is what authorization, audit, and the live list read. A connection with no window id keeps the device id as its client identity, so nothing changes for it.

**Boundary:** authorization scope comes from the device's ticket and never from the window id.

Anything server-core persists by client identity must be found and keyed by device instead, or a new window would lose it. Task 2.3 audits this before the identity changes.

- *Alternative: keep one client identity per device and add the connection id to each service's keys.* Rejected: it is the same change made in six places, and it leaves "which connection gets this client's event" undefined.

### 6. A cap of eight windows per device, refused not rotated

At the cap the host answers `application-authenticated` with `ok: false` and a typed error, and closes the peer. It does not evict the oldest window, because eviction is the behaviour this change removes. The client treats the error as unrecoverable for automatic retry and shows it. Eight is above any plausible deliberate use and below what would let one device exhaust a server.

### 7. Handshakes stay one at a time per device

The handshake slot remains keyed by device, and a newer `device-join` still retires an unfinished one. That is correct for a window retrying its own stalled attempt, which the host cannot yet tell from a second window. Two windows that start together resolve by the client's existing jittered backoff.

Desktop does better because it can: main serialises connection attempts to one server profile, so a window and its auxiliary window never race.

- *Alternative: carry the window id through the relays so handshakes are distinguishable.* Deferred: it needs a relay release in `terminay.com` and a change to the direct relay's single client slot, for a case that already converges.

### 8. Live connections are grouped by device

Status projections keep one entry per live connection and add its device id; the lists in Settings, the connection menu, and Remote Control group by device and show a window count. Closing from the list closes the device's windows.

### 9. The connected trigger is edge-triggered per device

`device.connected` fires when a device's live-peer count goes from zero to one, taken across both pairing hosts.

## Risks / Trade-offs

- [Server-core state keyed by client identity is orphaned or duplicated when identity becomes per window] → audited first (task 2.3); durable state moves to the device id, and connection-scoped state is already released on close.
- [Windows consume a pinned ICE port range faster] → the runbook states the budget; exhaustion is already reported as `ice-range-exhausted`. Defaults are an open question, not changed here.
- [A browser reload leaves the old window's peer until unload or liveness closes it] → it counts against the cap for at most the liveness deadline; the cap of eight absorbs it.
- [Two tabs restored together still knock out each other's handshake] → they converge on backoff; decision 7.
- [Browser tabs gain nothing until `terminay.com` ships the client change] → that change is one optional field; it is in this work's tasks.
- [A hostile client holds eight peers per device] → the same device could already hold one peer and reconnect in a loop; the cap bounds it, and revocation closes all eight.
- [Two windows typing into one terminal] → governed by the input and presentation rules that already apply between two devices.

## Migration Plan

1. Land the server change. Clients that send no window id are unaffected.
2. Land Desktop sending a window id and serialising its connects. Desktop windows on a remote server stop replacing each other against a new server; against an old server nothing changes.
3. Ship the browser client change in `terminay.com`.
4. `one-window-one-server` builds on step 2.

Rollback: revert the server change. Clients keep sending the field, an old server ignores it, and behaviour returns to one connection per device.

## Open Questions

- Should the standalone installer's default ICE port span rise from four, now that a person may open several windows?
- ADR-0013's third decision — a live peer for a device is replaced only by a peer that has consumed a ticket for that device — is narrowed to "for that device and window". The adr step records it.
