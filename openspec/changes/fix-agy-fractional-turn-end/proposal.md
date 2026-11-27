## Why

An idle Antigravity (`agy`) session keeps a yellow "working" dot on its terminal in the sidebar, tab strip and project dot for as long as `agy` runs, while every other agent view reports it idle. The cause: agy reports its last-turn end time with sub-millisecond precision (for example `1795772970190.7083`). The host's session-source validation accepts only a whole-millisecond integer, so it rejects the snapshot, and with it every other session in the same publication batch. The terminal never gets an agent entry and falls back to foreground-process activity, which reads a running `agy` as working.

## What Changes

- The built-in agents extension publishes the last-turn end time as whole epoch milliseconds, flooring any fractional value the library reports. It omits an end time that is not finite or falls outside the host's accepted range, so no library timestamp can make the host refuse a publication.
- Host validation of `lastTurnEndedAt` stays strict: an extension that publishes a non-integer is still refused.
- Regression tests: adapter tests for fractional end times in a catch-up reset and in a live upsert, and for unusable end times; a bridge test that a bound Antigravity session is exactly `idle` and drives its terminal's provider state; and a bridge test that a direct fractional publication is still refused.

## Capabilities

### New Capabilities

### Modified Capabilities
- `builtin-agents-extension`: the snapshot mapping publishes the last-turn end time in whole epoch milliseconds and omits unusable values. This delta builds on the `add-antigravity-agent-support` change's version of the same requirement, which must be archived first.

## Impact

- `extensions/builtin-agents/src/source.ts` (snapshot mapping) and its tests.
- `packages/server-core/test/session-source-bridge.test.mjs` (regression test).
- No change to the Extension API, host validation, or the IPC/extension boundary.
