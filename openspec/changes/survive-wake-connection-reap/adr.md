# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-07
- Reviewer: Mark Wylde
- Change: survive-wake-connection-reap

## In-Force ADR Context Reviewed

- openspec/adr/0028-no-polling-without-owner-approval.md - suspension is read
  from the heartbeat timers that already exist; the change adds no timer and no
  poll. Supersedes ADR-0022.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - the
  Desktop host stays protocol-blind: at most it reports that a byte endpoint it
  handed out has closed. Recovery is per connection. Supersedes ADR-0008.
- openspec/adr/0011-security-trust-boundary-model.md - the renderer stays
  untrusted; whether an interrupted project creation committed is read from the
  server's snapshot, never assumed by the client.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the endpoint-closed
  signal crosses main to renderer only and grants the renderer nothing.
- openspec/adr/0012-pwa-framed-session-host.md - the framed browser session
  shares the client heartbeat and gets the same suspend tolerance; its
  reconnect operation is unchanged.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md -
  unaffected; a project is still created on the server that owns it.
  Supersedes ADR-0009.
- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md -
  the one new Desktop E2E spec joins an existing shard. Supersedes ADR-0032.

The remaining in-force ADRs (0002, 0003, 0006, 0013, 0015, 0016, 0019, 0020,
0021, 0023, 0025, 0026, 0027, 0029, 0031, 0033, 0034, 0035, 0037, 0038, 0039,
0040) were read and do not bear on this change.

## Repository-Level ADRs Created

- openspec/adr/0041-liveness-deadlines-count-only-time-the-measurer-was-running.md -
  a liveness deadline that came due while its own side was suspended is
  replaced with a fresh one rather than honoured, detected from the timer that
  fired, and may only ever delay a retirement.

## Notes

Resolving an interrupted project creation from the resynchronised snapshot, and
making a failed pending tab an ordinary tab, are scoped to this change and are
recorded in its design; neither is a durable architectural commitment.
