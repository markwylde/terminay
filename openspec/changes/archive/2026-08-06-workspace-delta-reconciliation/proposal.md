## Why

After the initial snapshot the client requested `workspace.delta`, but the
server returned an envelope shaped as `{ state, events }` while the client fed
that envelope to the complete-snapshot parser. Validation failed before
publication and the event callbacks discarded the failure, so a browser stayed
on its initial tabs with no stale or error indication. Existing remote-tab
tests asserted source patterns rather than executing a real snapshot, event,
delta, and publish cycle, so nothing caught it.

## What Changes

- One exported, runtime-validated workspace-delta DTO carries the resulting
  scoped state and the ordered events, and both the server operations and the
  client facade use those shared validators and types.
- Casts that hid the shape disagreement are removed.
- Server identity, schema, revision and cursor monotonicity, event bounds,
  scope, references, and agreement between the envelope and its embedded state
  are validated before publication.
- A valid delta is applied atomically to the cached projection and published
  once; an invalid or stale delta retains the last confirmed projection as
  stale and performs one bounded full-snapshot recovery.
- Reconciliation failure is surfaced through connection and workspace state and
  diagnostics instead of being discarded in event or resync callbacks.
- Source-regex tab-sync assertions are replaced with runtime tests, a two-client
  protocol test, and a Docker-isolated Electron/browser end-to-end test.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-owned-workspace-state`: the delta envelope becomes a validated
  contract with atomic application, observable failure, and bounded recovery.

## Impact

The server `workspace.snapshot` and `workspace.delta` operations, the shared
protocol DTO and validators, `WorkspaceSnapshotStore` and the client workspace
facade, connection and workspace diagnostics, and the tab-sync test suites.
