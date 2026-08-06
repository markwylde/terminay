# Workspace delta reconciliation

## Goal

Make every connected Desktop and browser converge on the same server-owned
workspace revision after panel and project mutations, with explicit recovery
from malformed, stale, or unavailable deltas.

## Governing specifications

- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [Remote access](../features/remote-access.md)

## Current gap

After the initial snapshot, `WorkspaceSnapshotStore` requests
`workspace.delta`. The server returns a delta envelope shaped as
`{ state, events }`, but the client passes the envelope to the complete-snapshot
parser. Validation fails before publication, and event callbacks discard that
failure. The browser consequently remains on its initial tabs with no stale or
error indication.

Existing remote-tab tests primarily assert source patterns and do not execute a
real snapshot, live workspace event, delta, and publish cycle.

## Implementation slices

### Versioned delta contract

- [x] Define and runtime-validate one exported workspace-delta DTO containing
  the resulting scoped state and ordered events.
- [x] Make the server snapshot/delta operations and client facade use those
  shared validators and types; remove casts that hide shape disagreement.
- [x] Validate server identity, schema, revision/cursor monotonicity, event
  bounds, scope, references, and agreement between the envelope and embedded
  state before publication.

### Atomic reconciliation and recovery

- [x] Apply a valid delta atomically to the cached projection and publish once.
- [x] On invalid/stale delta, retain the last confirmed projection as stale and
  perform one bounded full-snapshot recovery without polling loops.
- [x] Surface reconciliation failure through the connection/workspace state and
  diagnostics; do not discard it in event or resync callbacks.
- [x] Coalesce changes arriving during refresh and prove the final published
  revision cannot regress or skip a committed mutation.

### Verification

- [x] Replace source-regex tab-sync assertions with runtime tests for initial
  snapshot, live create/close/move/activate, delta projection, concurrent
  changes, malformed delta, stale delta, resync, and scoped authorization.
- [x] Add a two-client protocol test proving one client's terminal-panel
  creation reaches the other with the same panel and session ids.
- [x] Add Docker-isolated Electron/browser E2E that creates and closes tabs in
  each client and verifies both converge without reload or polling. Run it only
  through `npm run test:e2e`.

## Acceptance checks

- Opening a second terminal tab in Desktop publishes it to an already-connected
  browser with the same workspace revision, panel id, and session id.
- Mutations initiated in the browser converge identically in Desktop.
- No valid delta is parsed as a complete snapshot, and invalid deltas cannot
  partially mutate the UI projection.
- A failed delta visibly marks state stale and either recovers from a complete
  authorized snapshot or reports a typed connection failure.
- Project-scoped clients cannot obtain objects or change records belonging to
  another project during delta or fallback snapshot recovery.

## Definition of done

The workspace snapshot/delta contract is shared and runtime-validated, failures
are observable and recover atomically, focused multi-client tests pass, and the
real Electron/browser tab-sync scenario passes through `npm run test:e2e`.
