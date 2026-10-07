# ADR-0048: A live connection belongs to a client window; authority belongs to the device

Status: accepted
Date: 2026-10-07

## Context

ADR-0013 bound pairing, approval, and credentials to a device, and said a live
peer for a device is replaced only by a peer that has consumed a valid
connection ticket for that device. In the implementation that became one live
connection per device: every authenticated join closed the device's previous
peer.

The purpose was to retire the dead connection a reconnect leaves behind. But a
device is a computer or a browser profile, and a person opens more than one
window on it. A second browser tab took the connection from the first. Two
Terminay Desktop windows on one remote server would do the same, and so would
a Desktop window and the Settings window it opened. The embedded Local server
has no such rule, so the product behaved differently depending on where the
server was.

The same conflation sat one layer down: a remote connection's workspace client
identity was its device id, so two connections of one device attaching one
terminal detached each other.

This record narrows ADR-0013's third decision. ADR-0013 otherwise stands.

## Decision

1. **A live connection belongs to a client window.** A window is one browser
   tab or one native window. A server holds at most one live connection per
   window per device, and a device may hold several windows.
2. **A window names itself on the authenticated channel.** It presents a
   random, non-secret window id with its connection ticket, never through a
   signaling relay. A replacement closes the previous peer of the same device
   and window, and no other. A peer still replaces another only after
   consuming a valid ticket for that device.
3. **A window id carries no authority.** It is scoped under its device, so it
   can address nothing belonging to another device. Authentication, approval,
   permission scope, audit, and revocation remain the device's. Revoking a
   device closes every window it has open.
4. **Each window is its own workspace client.** Attachments, input authority,
   presentation leases, checkpoints, and client-addressed events are scoped to
   the window's connection. The device id travels beside the client identity
   for authorization and audit.
5. **A device's windows are bounded and never rotated.** At the bound a new
   window is refused; no window is closed to make room for another.
6. **Absence is the old behaviour.** A connection that names no window is the
   device's one unnamed window.

## Rejected alternatives

- **Share one connection between windows in the host.** The host would have
  to understand the application protocol to multiplex requests,
  subscriptions, and flow control, which ADR-0008 and ADR-0018 keep out of
  it, and a browser has no host process to do it in.
- **Give each window its own device identity.** Every window would need
  pairing and approval, and revoking a computer would mean revoking several
  devices.
- **Carry the window id through signaling.** It would require coordinated
  relay releases and let an unauthenticated joiner name a window.

## Consequences

- Several windows of one device work against a remote server as they do
  against Local, including a window and its auxiliary windows.
- Revocation must enumerate a device's live peers, in every pairing host.
- A pinned ICE port range is consumed per window, not per device.
- Lists of live connections group by device.
- Two handshakes of one device remain indistinguishable to a relay and stay
  one at a time.

## Open items

- Whether to carry window identity through signaling so concurrent handshakes
  of one device do not retire each other.
- Default ICE port spans for standalone installs.
