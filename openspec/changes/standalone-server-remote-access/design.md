## Context

Desktop's embedded server registers `remote-access.*` operations through
`ServerTerminalAuthority`'s `applicationFeatures.remoteAccess`. Behind them is
`DesktopServerOwnedExposure` (`electron/remote/serverOwnedExposure.ts`), which
starts and stops one hosted pairing host at runtime and projects
`ServerRemoteExposure` state into the client's `RemoteAccessStatus`.

Standalone `terminay-server` (`apps/terminay-server/src/cli.ts`) composes its
own operation registry and registers no `remote-access.*` operation. The client
(`src/services/serverApplicationFeatureClients.ts`) sends them anyway, so
**Expose this server…** fails with "unknown operation". Because the status query
is also missing, the page falls back to "Stopped" whatever the server is doing.

The standalone exposure lifecycle is fixed at startup:

- `remote` (`ServerRemoteExposure`) is built with a session origin. That is the
  provisioned hosted origin when `--expose hosted` is given; otherwise it is
  the `--remote-origin` value or its `<id>.remote.terminay.local` default.
- `remote.start()` always runs. Its handoff token also authenticates the local
  HTTP endpoint (`createProtocolServer`).
- The direct listener (TLS and `/signal` upgrade) is created only when
  `--expose` includes `direct`, and it is installed on the protocol server at
  construction.
- Pairing hosts for `hosted` and `direct` are started inside `start()` only for
  the `--expose` modes. `createSharedPairingHandoffRotator` keeps every mode on
  one room, but its mode list is fixed when it is created.
- The approval socket (`approve`, `deny`, `approvals`, `pairing`) drives
  `remote` and the pairing hosts.
- Every admitted remote device client and local client is given authorization
  scope `admin` (`hostedPairingHost.ts`, `cli.ts`).

`terminay daemon` installs servers with `TERMINAY_EXPOSE=hosted,direct`, so
most real standalone servers are already exposed. Users mostly need truthful
status and **Create pairing link**.

## Goals / Non-Goals

**Goals:**

- Every `remote-access.*` operation works against a standalone server with the
  same payloads and result shape as Desktop.
- Status is truthful whether exposure was started by `--expose` or by a client,
  and it updates without polling.
- A client can start and stop exposure without a restart, using the modes the
  server was configured with.
- One pairing room, device registry, approval queue and host key, shared by
  client operations, operator socket commands and every exposure mode.

**Non-Goals:**

- Persisting a runtime start or stop. `--expose`, and the daemon's environment
  file, remain the standing decision.
- Starting a mode at runtime that the server was not started with. In
  particular, there is no runtime direct listener: direct needs a TLS listener
  on the advertised port, which is built at startup.
- A finer per-device administrative capability. Operations require scope
  `admin`, which is the scope admitted clients have today.
- Any renderer, protocol or UI change.

## Decisions

### 1. A standalone runtime exposure controller owns the pairing hosts

Move the pairing-host lifecycle out of the `start()` closure in `cli.ts` into
`StandaloneRemoteAccess` (`apps/terminay-server/src/remote/standaloneRemoteAccess.ts`).
`cli.ts` injects `remote`, the configured mode list, and a
`startPairingHost(mode, handoff, rotateHandoff)` factory that closes over
today's options (host key path, signal options, ICE, UI archive, device
persistence, direct handoff mapping). The controller exposes:

- `expose()`: builds a new shared rotator over exactly the modes it is about to
  start, takes the current handoff (rotating it if a previous generation
  consumed it), and starts each mode in turn. On the first failure it closes the
  modes already started, records the error, and stays stopped.
- `stop()`: marks exposure stopped, resolves pending approvals as `closed`,
  then closes every pairing host and forgets the rotator. It does **not** call
  `remote.stopExposure()`, because that would also invalidate the local-HTTP
  handoff the protocol server was started with. Pairing and reconnect are
  blocked because no host is registered with any signaling endpoint.
- `createPairingLink()`: rotates once through the active rotator, then awaits
  `mintPairing()` on every running host. A mode that throws fails the command
  with that mode's error.
- `approveDevice`, `denyDevice`, `revokeDevice`, `closeConnection`,
  `resetIdentity`, `status()` and `onChange(listener)`.

The **mode policy** answers Codex finding 1. Runtime exposure starts the
`--expose` modes, or `hosted` when there are none. So a direct-only server never
depends on the hosted relay, and direct is never started without the listener
prepared at startup.

**Rotator per exposure generation** answers finding 2. The rotator's fixed mode
list is correct within one generation. A fresh one is built at each `expose()`
over the modes actually starting, so no mode is unknown and no inactive mode
blocks rotation.

Startup calls `expose()` for the `--expose` modes before readiness is printed,
so startup and runtime exposure share one code path and readiness ordering is
unchanged. The approval socket's authority is rebuilt over the controller.

*Serialisation (finding 10).* The controller runs `expose`, `stop`,
`createPairingLink`, `resetIdentity`, approve and deny on one operation queue,
the existing `createPairingOperationQueue`. The pairing hosts' own timed refresh
keeps using the per-room queue (`serializePairingRefresh`), which is
unchanged. A host closed by `stop()` cancels its refresh timer (existing
`close()` behaviour), so a refresh cannot register a room after stop.

*Boundary:* exposure, device trust and host-key custody stay inside the server
process (`apps/terminay-server`), as the architecture requires. Clients only
send commands over the authenticated application protocol.

### 2. Authorization: scope `admin`

Each remote-access operation checks `request.context.authScope === 'admin'`
and otherwise fails with the protocol's forbidden error. That makes the existing
"administrative capability" wording in `connections-and-client-hosts` concrete,
and answers finding 6. Admitted clients are `admin` today, so behaviour is
unchanged for them, and a narrower future scope is refused by default.
Attached-server isolation is unchanged: each server answers only for itself on
its own connection.

### 3. Exposure state is the administrator's intent, health is separate

`isRunning` is the controller's `exposed` flag, set when `expose()` succeeds
and cleared by `stop()` or a failed re-registration. Pairing-room expiry,
rotation and signaling reconnects (handled inside `hostedPairingHost` with
retries) do not change it. The pairing link is reported from the controller's
latest handoff: hosted compact URL when hosted runs, otherwise the direct URL.
`webRtcStatus` is `pairing-ready` while a room is registered and `registering`
otherwise. This answers finding 4.

### 4. One status projection for Desktop and standalone

Move `projectStatus` from `electron/remote/serverOwnedExposure.ts` to
`apps/terminay-server/src/remote/remoteAccessStatus.ts`, with a structural
`RemoteAccessStatus` declared there and assignable to `src/types/terminay.ts`.
It takes `isRunning`, the pairing URL and the hosted connection list as inputs.
Desktop passes what it passes today, so its output is unchanged.

### 5. Change events from every source

The controller subscribes to `remote.onApprovalRequested` and
`remote.onApprovalResolved`, receives `onPeerConnected`, `onPeerDisconnected`,
`onHandoff` and `persistDevices` callbacks from each host it starts, and wraps
the approval-socket operations. Each one fires `onChange`. The controller keeps
the connection list across modes, keyed by connection id, as Desktop does.
Subscriptions are removed in `stop()` and on shutdown. `cli.ts` wires `onChange`
to the event journal as `remote-access.changed`, through a holder that
`createServerComposition` receives before the controller exists. The existing
automation trigger on `onPeerConnected` is kept. This answers finding 7.

### 6. Answer first, then disconnect

`toggle-server` while exposed and `reset-identity` compute the resulting status
and return it. The disruptive part (closing hosts, closing peers) is scheduled
with `setTimeout(…, RESPONSE_GRACE_MS)` (250 ms) on the controller queue, so the
command's result frame is written to the requesting connection before that
connection closes. The status returned already reflects the end state (stopped,
or devices revoked). Before the grace timer fires, the controller also refuses
new pairing and joins (`exposed` is already false). This is a best-effort
ordering, not a delivery proof. If the frame is lost, the client sees the
connection drop it asked for. Codex finding 5 is taken in part.
`close-connection` and `revoke-device` on the caller's own connection follow
the same rule.

### 7. Identity reset ordering

`resetIdentity()` runs in this order:

1. Rotate `remote-host-key.v1.json` with `rotateHostedHostKey`. If that throws,
   nothing has changed and the error is returned.
2. `remote.revokeAllDevices()`, persist the registry, and resolve approvals as
   closed. Revocation is never rolled back. A persistence failure is reported,
   while in-memory revocation still blocks every device.
3. If exposure was running, stop it after the response grace, then `expose()`
   under the new key. A failure leaves exposure stopped with the error in
   status.

The offline `reset-identity` CLI command is unchanged. This answers finding 8.

### 8. Session origin only changes for servers that never exposed remotely

Finding 9 is correct that device challenges carry the session origin, so
changing the origin of a data root that already has paired remote devices
would break them. The rule is therefore narrow. A `start` with **no** `--expose`
mode and no explicit `--remote-origin` now calls `loadOrCreateSessionOrigin`
(the same file `--expose hosted` uses), and its pairing format becomes
`hosted-compact`. Every other combination keeps today's origin and format:
`--expose hosted`, `--expose direct`, both, or an explicit origin. Remote
devices could only have been paired on such a server through `--expose`, which
used either the same provisioned origin (`hosted`) or one that is still used
(`direct`). Local-HTTP pairing on a never-exposed server is the only path whose
origin changes. That path uses a per-start handoff and holds no remote device
binding.

*Alternative:* rebuild `remote` on first runtime exposure. Rejected: it would
discard the local-HTTP credential the protocol server holds and split the
approval queue.

## Risks / Trade-offs

- [Stopping exposure from a remote client locks remote clients out until a
  restart or local action] → Same as Desktop. The daemon's restart applies
  `--expose` again, and this is documented in the runbook.
- [Moving pairing-host start-up out of the `start()` closure regresses startup
  ordering] → `expose()` is awaited at the same point with the same inputs. The
  existing standalone hosted, direct and approval tests cover it.
- [Runtime start without `TERMINAY_UI_RENDERER_DIRECTORY` would pair a device to
  an empty page] → `expose()` refuses with the same message startup uses.
- [The 250 ms grace keeps closed exposure briefly reachable for already-open
  peers] → New pairing and joins are refused immediately. Only existing
  sessions linger for that window.

## Migration Plan

No data migration. A server first started on this version with no `--expose`
writes the session-origin file `--expose hosted` would write. Rollback leaves
that file unused, and the older version ignores it unless `--expose hosted` is
given, in which case it reuses it as before.

## Open Questions

None.
