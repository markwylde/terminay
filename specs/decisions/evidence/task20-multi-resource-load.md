# Task 20 representative multi-resource load evidence

Date: 2026-07-28

The focused local load gate combines the real server-core terminal service
pressure harness with the deterministic concurrent workspace-lane scheduler.
It runs six complete iterations and covers:

- 24 PTYs and 120 simultaneous terminal subscriptions per iteration;
- bounded replay and slow-consumer queues;
- terminal output, input, resize, detach, resume, and reconnect activity;
- 12 concurrent clients producing file-watch, agent, file-transfer, recording,
  and reconnect pressure;
- 67,392 total projection updates;
- 679,477,248 logical file-transfer bytes in fixed 64 KiB chunks; and
- 84,934,656 logical recording bytes in fixed 16 KiB chunks.

Every produced projection update is either delivered or explicitly coalesced.
All PTYs stop, every client recovers, data and reconnect queues drain, and
retained update age stays within four scheduler frames. Peak JavaScript heap
growth is bounded to 64 MiB and the complete local probe has a 30-second
latency ceiling.

The recorded focused run completed the six iterations in 38.288 ms with
6,625,920 bytes of peak heap growth. It finished with zero active PTYs and
zero retained data or reconnect queue entries.

Focused validation:

```sh
node --test scripts/task20-multi-resource-load.test.mjs
```

This is representative local server-core and deterministic scheduling evidence.
It is not native multi-platform throughput, browser memory profiling, or
selected-WebRTC-runtime/TURN evidence; those remain separate operational
release follow-ups.
