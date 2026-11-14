# ADR-0120: Every server host serves runtime exposure control over the application protocol; startup configuration is only the standing decision

Status: accepted
Date: 2026-11-14

## Context

The remote-access contract applies one exposure model to embedded and
standalone servers. Only Desktop's embedded server registered the
`remote-access.*` application operations, though. A standalone
`terminay-server` decided exposure once, from `--expose` at startup, and
offered control only through local operator commands on its approval socket.
Clients attached to a standalone server showed the exposure page, but every
action failed with "unknown operation", and the status always read "Stopped".
To pair a second device, the user needed a shell on the server.

## Decision

1. Every server host (embedded and standalone) serves the complete
   `remote-access.*` operation set and the `remote-access.changed` event over the
   authenticated application protocol. One server-owned projection produces the
   status shape. Each operation requires authorization scope `admin`.
2. A server's exposure can be started and stopped while it runs. Startup
   configuration (`--expose`, or Desktop's **Automatically expose server on
   startup**) is the standing decision applied at each start. A runtime start or
   stop is not persisted and does not change it.
3. Runtime exposure starts the modes the server was configured with, or hosted
   when none were configured. It never starts a mode whose prerequisites are
   decided at startup, such as the direct listener. So a direct-only server
   never gains a hosted dependency.
4. Runtime exposure and configured exposure take the same code path. They share
   one session origin, host key, device registry, approval queue and pairing
   room. A standalone server with no configured mode and no explicit origin
   provisions its stable hosted session origin at start. Every other server
   keeps the origin its options select, so already-paired devices are
   unaffected.

## Alternatives considered

- Keep exposure startup-only and hide the controls for standalone servers.
  Rejected: it leaves pairing a second device requiring a shell on the server,
  and splits the one exposure model.
- Persist runtime toggles as a new standing decision. Rejected: the daemon's
  environment file already owns that decision, and two sources of truth would
  disagree after an upgrade.
- Rebuild the exposure authority with a new origin on first runtime exposure.
  Rejected: it would discard the local-HTTP credential and split the approval
  queue.

## Consequences

- An admin client can manage a standalone server's exposure, as on Desktop. A
  future narrower scope is refused by default on both host kinds.
- A client that stops exposure over the connection being stopped loses that
  connection after it receives the result. Reaching the server again needs the
  local endpoint or a restart, which applies the standing decision.
- A standalone server that has never been exposed writes its session-origin
  file at start.
