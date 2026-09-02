# Task 20 shared UI responsiveness evidence

Date: 2026-07-27

`scripts/task20-responsiveness.test.mjs` runs a deterministic virtual 60 Hz
shared-UI scheduler. It feeds four bounded background streams—terminal output,
agent events, file-watch updates, and transfer progress—while fixed input
events arrive at both early- and late-frame offsets.

The probe records these local results:

- 1,380 background updates are produced and 250 latest-per-stream updates are
  applied; 1,130 superseded updates are coalesced rather than retained;
- the background queue peaks at 4 entries and drains to zero;
- all 72 input events are handled with a maximum virtual latency of 16.517 ms;
- maximum virtual frame work is 4.9 ms against a 16.667 ms frame budget; and
- two immediate runs produce identical metrics with no remaining input or
  background work.

This proves only the shared scheduler's deterministic local budget and
coalescing contract. It does not claim browser rendering, native Desktop or
mobile frame-rate measurements, GPU behavior, or responsiveness under real
network/PTY workloads; the parent native responsiveness gate remains open.

The focused command is:

```sh
node --test scripts/task20-responsiveness.test.mjs
```
