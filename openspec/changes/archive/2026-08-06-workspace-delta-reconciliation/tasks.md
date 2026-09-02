## 1. Versioned delta contract

- [x] 1.1 Define and runtime-validate one exported workspace-delta DTO
  containing the resulting scoped state and the ordered events
- [x] 1.2 Make the server snapshot and delta operations and the client facade use
  those shared validators and types, and verify the casts that hid shape
  disagreement are removed
- [x] 1.3 Validate server identity, schema, revision and cursor monotonicity,
  event bounds, scope, references, and envelope-to-state agreement before
  publication

## 2. Atomic reconciliation and recovery

- [x] 2.1 Apply a valid delta atomically to the cached projection and verify it
  publishes exactly once
- [x] 2.2 On an invalid or stale delta, retain the last confirmed projection as
  stale and perform one bounded full-snapshot recovery, verifying no polling loop
- [x] 2.3 Surface reconciliation failure through connection and workspace state
  and diagnostics, and verify it is not discarded in event or resync callbacks
- [x] 2.4 Coalesce changes arriving during refresh and prove the final published
  revision cannot regress or skip a committed mutation

## 3. Verification

- [x] 3.1 Replace source-regex tab-sync assertions with runtime tests for initial
  snapshot, live create/close/move/activate, delta projection, concurrent
  changes, malformed delta, stale delta, resync, and scoped authorization
- [x] 3.2 Add a two-client protocol test proving one client's terminal-panel
  creation reaches the other with the same panel and session ids
- [x] 3.3 Add Docker-isolated Electron and browser end-to-end coverage that
  creates and closes tabs in each client and verifies both converge without
  reload or polling, run only through `npm run test:e2e`
