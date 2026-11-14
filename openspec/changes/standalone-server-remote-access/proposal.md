## Why

A Desktop or browser user connected to a standalone server (for example one
installed with `terminay daemon`) opens Settings → Remote Access, or the
connection menu, and selects **Expose this server…**. Nothing happens except
the line "unknown operation remote-access.toggle-server". The page also says
**Exposure · Stopped** with no trusted devices, even when the server was
started with `--expose hosted,direct` and is serving the very connection the
user is on. **Create pairing link**, approving a waiting device, revoking a
device, closing a connection and **Reset server identity** fail in the same
way. So to pair a second device with a remote server, the user needs a shell on
that machine and the `terminay-server pairing` command.

The cause is that only the embedded Desktop server registers the
`remote-access.*` application operations. Standalone `terminay-server` decides
exposure once at startup from `--expose` and offers no runtime control over
the application protocol. That breaks the remote-access contract that one
exposure model applies to embedded and standalone servers.

## What Changes

- Standalone `terminay-server` serves `remote-access.status` and every
  `remote-access.*` command that Desktop serves: `toggle-server`,
  `create-pairing-link`, `approve-device`, `deny-device`, `revoke-device`,
  `close-connection` and `reset-identity`. It publishes
  `remote-access.changed` whenever any of them changes what the status
  reports.
- Status reports what the server is actually doing. **Running** means at least
  one exposure mode (hosted or direct) is registered. Status also carries the
  current pairing link, trusted devices, live remote connections, pending
  approvals, and any exposure error.
- **Expose this server…** on a standalone server that is not exposed starts
  hosted exposure while the server runs, and also direct exposure when the
  server was configured with a direct origin. No restart is needed. To make
  that possible, a standalone server always provisions and reuses its stable
  hosted session origin, unless `--remote-origin` names an explicit origin.
- Stopping exposure from a client closes every exposure mode's pairing room and
  reconnect registration and closes live remote connections. The local
  endpoint, terminals and server-owned work keep running. `--expose` stays the
  standing decision, so the next start re-applies it. Exposing or stopping
  while the server runs is not persisted.
- **Reset server identity** on a running standalone server rotates the host key
  file, revokes every device, closes live remote connections, and re-registers
  each running exposure mode under the new key. It is the same as the offline
  `reset-identity` command.
- Operator commands that use the approval socket (`approve`, `deny`,
  `approvals`, `pairing`) act on the same exposure state as the client
  operations.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: exposure is controllable while a standalone server runs,
  from any authenticated client, through the same operations as Desktop. The
  standalone server always has its stable hosted session origin. Runtime
  control does not change the `--expose` standing decision.
- `connections-and-client-hosts`: the exposure flow against an attached
  standalone server shows that server's real status and controls.

## Impact

- `apps/terminay-server/src/cli.ts`: start-up composition of exposure modes,
  session-origin provisioning, and registration of the `remote-access.*`
  operations.
- New `apps/terminay-server/src/remote/standaloneRemoteAccess.ts`: the runtime
  exposure controller, which owns the pairing hosts for each mode, status,
  and the commands.
- The status projection now in `electron/remote/serverOwnedExposure.ts` moves
  into `apps/terminay-server/src/remote/` so Desktop and standalone report
  status the same way.
- `docs/operations/standalone-server.md`: runtime exposure control from a
  client, and its relation to `--expose`.
- No protocol, renderer or UI change: `src/services/serverApplicationFeatureClients.ts`
  already speaks these operations.
