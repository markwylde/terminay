## Why

A terminal that has been open for more than a day loses its Terminay MCP tools.
Every call from an agent in it, such as `show_window`, fails with
`invalid_token` ("missing, invalid, stale, or revoked"), while a freshly opened
terminal works. Restarting the agent does not help, and neither does restarting
Terminay; only a new terminal recovers.

The cause is a fixed 24-hour expiry on each terminal's capability token. The
token is delivered once, in the terminal's launch environment, which cannot be
updated afterwards, so an expired token can never be replaced for that
terminal. The spec never asked for a time limit: it ties a token's life to its
terminal.

## What Changes

- A terminal's capability token has no time-based expiry. It lives exactly as
  long as its terminal, ending on terminal exit, explicit revocation, project or
  space change, server shutdown, or MCP disablement, as before.
- The server prunes capabilities whose terminal is no longer running, at start
  and once a day, so a missed exit event cannot leave a capability behind.
- Persisted capabilities no longer carry an expiry. Saved entries written with
  one are still read; the field is ignored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: the capability lifecycle requirement states that a token has no
  time-based expiry, and that capabilities for terminals no longer running are
  pruned.

## Impact

- `apps/terminay-server/src/mcp/controlEndpoint.ts` — `ControlCapabilityStore`
  drops `ttlMs` and `expiresAt`, and gains `prune(runningSessions)`.
- `electron/main.ts` — no TTL; a daily prune against the server's running
  sessions.
- `apps/terminay-server/test/control-capability-persistence.test.mjs` — expiry
  cases replaced by long-lived and pruning cases.

Terminals already past 24 hours when this ships stay broken, because their
expired tokens were never saved; new terminals are unaffected.
