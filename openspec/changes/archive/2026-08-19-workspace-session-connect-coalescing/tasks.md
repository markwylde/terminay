## 1. Coalesced connect

- [x] 1.1 Treat workspace `connect` as acquisition of the current session-host generation and start no second signaling join, verified by renderer-focused tests asserting one join.
- [x] 1.2 Subscribe to the transport endpoint or session-host lifecycle after connect returns and ignore `closed`/`failed` from a retired generation, verified by a test emitting `closed` for a retired generation during first hydration and asserting no second connect and no unmount of the current client.
- [x] 1.3 Cover first mount, automatic recovery, and Retry with one in-flight attempt so overlapping `connect()` is impossible, and give a hung attempt a bounded deadline returning to retry-wait, verified by coalescing tests.
- [x] 1.4 Drive reconnecting UI from that attempt so a painted workspace whose client was disposed cannot remain marked connected, verified by UI state tests.

## 2. Acceptance

- [x] 2.1 Verify Retry during an in-flight attempt is coalesced rather than a competing join.
- [x] 2.2 Verify that after a real current-generation failure, Retry creates one fresh attempt and live terminal input resumes without a reload.
