## 1. Protocol

- [x] 1.1 Add `hostStats.ts` (capability, operations, event, sample type, interval bounds) and the `host-stats.v1` feature and optional capability. Verified by `packages/protocol` tests.

## 2. Server

- [x] 2.1 Pure parsers for `/proc/meminfo`, `/proc/net/dev`, `/proc/diskstats`, macOS `sysctl`/`netstat -ibn`/`ioreg` output. Verified by fixture unit tests.
- [x] 2.2 `HostStatsService`: per-connection watches, timer at the minimum interval, baseline then deltas, publish transient samples, tear down on last unwatch, close and dispose. Verified by unit tests with a fake timer and reader, including "no subscribers, no reads".
- [x] 2.3 Compose it in server-core: operations, namespace, advertised capability, `onConnectionClosed`, shutdown. Verified by `capability-coverage` and `server-composition` tests and a connection test that a disconnect stops sampling.

## 3. Client

- [x] 3.1 Device-local `hostStats` setting with defaults, normalisation, and a Status Bar section in Appearance. Verified by `src/terminalSettings.statusBar.test.ts`.
- [x] 3.2 `hostStatsModel.ts`: formatting, tooltips, sparkline points, bounded history. Verified by unit tests.
- [x] 3.3 `useHostStats` hook and `HostStatsStrip` in the status bar, following the active tab's server and document visibility. Verified by `scripts/workspace-status-bar.test.mjs` and the E2E scenario.

## 4. Verification

- [x] 4.1 Typecheck, lint, the boundary check, the protocol and server-core suites, `test:workspace-models` and the status bar, settings and host stats tests pass. The full `smoke` script is left to CI.
- [x] 4.2 E2E: with host stats on, the status bar shows CPU and memory items. With them off, it shows none. Run through `npm run test:e2e`.
- [ ] 4.3 Manual: on a macOS host, all four items show plausible figures.
- [ ] 4.4 Pull request checks green.
