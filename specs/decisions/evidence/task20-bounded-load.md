# Task 20 bounded load evidence

Date: 2026-07-27

`task20-bounded-load.test.mjs` runs a deterministic local probe against the
server-core terminal service with in-memory PTY and client doubles. The fixed
profile creates 24 PTY sessions, attaches four push clients and one queued
consumer to each session, performs 288 writes and 96 resizes, emits 2,352
fixed-size output events, and performs one detach/resume cycle per session.

The probe proves these local bounds and cleanup properties:

- 24 PTY doubles are created and no PTY double remains active after shutdown;
- 96 live push attachments and 120 total live subscriptions are the observed
  peaks;
- each session admits exactly four push clients and one pull consumer, rejects
  one additional authenticated subscriber with the explicit
  `subscriber_limit` error, and still permits the later detach/resume cycle;
- the slow pull consumers peak at 192 queued bytes against a 256-byte bound;
- retained replay peaks at 2,016 bytes against a 2,048-byte bound;
- all 2,352 output events reach each of the four client streams exactly once,
  including the two events replayed during each detach/resume cycle; and
- two immediate runs produce identical metrics.

This is bounded, deterministic test-double evidence for PTY, client, terminal
event, replay, queue, write, resize, and reconnect pressure. It does not claim
native multi-platform execution, signed artifacts, real PTY behavior, file
watchers, file transfers, recordings, agent providers, network reconnects, or
the complete task-20 load matrix; the parent load-test item remains open.

The companion `task20-matrix-load.test.mjs` virtual scheduler also exercises
12 clients across terminal, file-watch, agent, file-viewer, recording, and
reconnect lanes. After producers stop, it drains every retained latest-value
update within a fixed four-frame cleanup bound, leaves both queues empty, and
accounts for every produced update as applied or explicitly coalesced. During
pressure it also measures each applied update's age and rejects any stream lane
that exceeds the fixed four-frame retention bound, preventing a quiet lane from
being starved by terminal traffic. This is deterministic retention, cleanup,
and fairness evidence only, not native memory profiling or real
provider/filesystem/network throughput.

The focused command is:

```sh
npm run build --workspace @terminay/server-core
node --test scripts/task20-bounded-load.test.mjs
```
