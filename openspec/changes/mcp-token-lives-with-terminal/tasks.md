## 1. Capability store

- [x] 1.1 Remove `ttlMs` and `expiresAt` from `ControlCapabilityStore`, its
      lease, and persisted entries; the parser ignores a saved `expiresAt`.
      Verified by `apps/terminay-server/test/control-capability-persistence.test.mjs`.
- [x] 1.2 Add `prune(runningSessions)` that revokes capabilities for sessions
      not running, through the normal revocation path. Verified by new cases in
      the same test file.

## 2. Desktop

- [x] 2.1 Construct the store without a TTL, prune after restoring saved
      capabilities, and prune every 24 hours on an unref'd timer cleared at
      shutdown. Verified by `npm run typecheck` and the server test suite.

## 3. Validation

- [x] 3.1 `openspec validate --all` passes.
