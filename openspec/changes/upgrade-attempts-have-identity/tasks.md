## 1. Protocol and client-core

- [x] 1.1 Add `server.upgrade.attempts`, the `server.upgrade.attempt` query and event, the `ServerUpgradeAttempt` type and its strict parser, and an optional bounded `requestId` on the start request to `packages/protocol/src/serverUpgrade.ts`. Leave the status shape unchanged. Verified by protocol tests that parse every attempt shape, reject an unknown stage or ending kind and an oversized id, and run the unchanged status parser against every status a server with attempts publishes.
- [x] 1.2 Add an attempt store to `ServerUpgradeClient` in `packages/client-core`, subscribed only when the hello advertises the capability, and let `startServerUpgrade` take a request id that is sent only then. Verified by client-core tests with a capability-less transport and one with the capability.

## 2. Upgrader records every run (CLI)

- [x] 2.1 Extend `apps/terminay-cli/src/outcome.ts` with `started`, `unchanged`, and `failed` kinds, `run`, and structured releases. Write through a unique temporary name. Accept every kind when reading. Verified by outcome tests that round-trip each kind and write concurrently without collision.
- [x] 2.2 Add the install-wide lock (`upgrade.lock` in the prefix): exclusive create, takeover of a dead holder, and refusal with no record while the holder runs. Verified by lock tests: held, stale, and released on both success and throw.
- [x] 2.3 In `runUpgrade`, take the lock and write `started` before resolving. Write `unchanged` on both already-current branches. Move `succeeded` to right after readiness, so later bookkeeping failures cannot replace it. The outer wrapper writes `failed` only when this run wrote no ending. Verified by upgrade tests: already current, channel unreachable, readiness rollback, a pruning failure after success, and a held lock.
- [x] 2.4 Apply the same lock and records to install-latest, the container in-place upgrade, and recreate. Move recreate's success after `startAndAwaitHealthy()`. Verified by their tests, plus a recreate whose replacement starts and then fails health, which records no success.
- [x] 2.5 Report `recordPath` and the new record kinds in `daemon upgrade --check`, without locking or writing. Add the peeked revision to `available` and `latest` for rolling builds in the newer and older branches of `findAvailable`. Verified by `apps/terminay-cli/test/check.test.mjs`.

## 3. Server host

- [x] 3.1 Accept `recordPath` and every record kind in `apps/terminay-server/src/releaseUpgrader.ts`, and add `readRecord()` and `watchRecord(listener)`, a directory watch filtered to the record and `install.json`. Verified by tests that parse each kind and see the listener fire on an atomic rename of either file.
- [x] 3.2 Add a file-backed attempt store in the data root (`server-upgrade-attempt.v1.json`, atomic replace, malformed content ignored), and pass it, with `serverRevision`, to the service in `apps/terminay-server/src/cli.ts`. Verified by store tests.

## 4. Server service

- [x] 4.1 Create, persist, and publish attempts under one mutex. Refuse when persistence fails or when the record shows a fresh unended `started`. Take up a persisted attempt at start, keeping its stage semantics. Keep an ended attempt as the last attempt. Verified by `packages/server-core/test/server-upgrade-service.test.mjs`: concurrent starts, persistence failure, recovery with and without a bound run, and an outcome surviving a second restart.
- [x] 4.2 Arm the watch with an immediate read while an attempt is pending or the record is stale. Bind the first fresh `started` run, end only on that run's ending, ignore other runs, read again on a spawned upgrader's exit, and check the channel after each ending. Verified by service tests: unchanged, succeeded, rolled back, failed, another run's ending, an exit without a record, and a watch that cannot be armed.
- [x] 4.3 Derive the absolute deadlines (2-minute bind, `expiresAt`) from persisted times, and re-arm them for the time remaining after a restart. Verified by fake-timer tests, including repeated restarts and an expired attempt with a changed revision that ends as unknown, not success.
- [x] 4.4 Compare builds by revision: withhold `available` and `latest` while the record is stale, check on the record's rewrite and on attach while stale, and never offer `serverRevision`. Verified by service tests for a stale record with no attempt and for the same version string with a different revision.
- [x] 4.5 Publish the attempt through `server.upgrade.attempt` and advertise the capability, and map the attempt onto the unchanged status. Accept `requestId` in the start handler. Verified by `packages/server-core` protocol-registry tests.

## 5. Client

- [x] 5.1 Follow attempts by id in `src/workspace/serverUpgradeModel.ts`, against servers advertising attempts. Remember the request id, target, and mode before sending, and bind by request id. Steps come from stage and phase, and endings from the attempt's ending plus the connection-level endings. A late reply for an ended attempt changes nothing. Keep the existing rules in one function, used only for servers without the capability, including one that returns without it. Verified by `src/workspace/serverUpgradeModel.test.ts`: the stuck-on-Installing sequence ending as unchanged, a lost reply, a reload at `finishing`, another attempt's ending, the helper never starting, a downgrade to a server without attempts, and the existing scenarios for servers without attempts.
- [x] 5.2 Route every start through the board: `useServerUpgrades.ts` and both start paths in `SettingsServerUpdates.tsx`, including Install latest. Verified by model tests for each path and a type check.

## 6. Verification

- [x] 6.1 Add a host-level integration test: a real attempt store, the real record writer from the CLI, the real `watchRecord` in a temporary prefix, the service through a simulated restart, and the board reading the published attempt. It covers persist → start record → restart → identified ending → reloaded board. Verified by the test passing. The Docker E2E suite drives the Electron UI and cannot run a release upgrade; this test covers the sequence end to end at the process boundary.
- [x] 6.2 Run the affected suites: `packages/protocol`, `packages/client-core`, `packages/server-core`, `apps/terminay-cli`, and `apps/terminay-server`, each built first with `npx turbo run build --filter=<package>...`, plus the workspace model test with `node --test --test-force-exit --test-timeout=120000 --experimental-strip-types`. Verified by every run passing.
- [x] 6.3 Run the repository's TypeScript type check and lint. Verified by a clean result.
- [x] 6.4 Run `openspec validate --all`. Verified by this change passing. Failures belonging to other active changes are reported, not fixed here.
