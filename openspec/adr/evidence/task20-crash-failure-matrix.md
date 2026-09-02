# Task 20 crash and failure matrix evidence

Date: 2026-07-28

The complete focused failure matrix passed:

```sh
node --test \
  scripts/server-state-sqlite-crash.test.mjs \
  scripts/task20-clock-failure.test.mjs \
  scripts/task20-crash-restart.test.mjs \
  scripts/task20-provider-outage.test.mjs \
  scripts/task20-outage-signaling.test.mjs \
  scripts/task20-turn-outage.test.mjs \
  scripts/task20-sleep-network.test.mjs
```

Result: 20/20 tests passed in 581 ms.

The executable matrix covers:

- serialized Desktop Local authority crash recovery without overlap;
- three real standalone foreground child crash/restart cycles using the same
  data root and health listener;
- interrupted SQLite transactions and migrations;
- corrupt canonical state recovered beside preserved corrupt evidence;
- actual POSIX read-only file/directory permissions with no canonical mutation;
- deterministic SQLite capacity exhaustion with rollback and later recovery;
- bounded WAL writer contention and revision conflicts;
- provider retry exhaustion/recovery with exact resource cleanup;
- authenticated signaling failure and fresh recovery;
- TURN allocation failure, retry, and cleanup;
- sleep/offline/online/wake coalescing with stale-completion rejection; and
- wall-clock rollback/forward jumps and monotonic elapsed-time validation so an
  expired lease cannot be extended or revived.

The SQLite capacity test is deterministic quota evidence rather than filling a
physical disk. Provider, signaling, TURN, sleep, network, and clock tests use
injected deterministic failure boundaries; they do not claim external provider
incidents, hosted infrastructure outages, or physical device sleep execution.
