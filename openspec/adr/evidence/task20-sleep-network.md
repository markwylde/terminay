# Task 20 sleep and network transition evidence

The deterministic local probe models one connected client across network loss,
offline churn, sleep, online restoration during sleep, wake, and recovery.

It proves that:

- reconnect demand is coalesced to one pending request;
- no connection resource is allocated while offline or asleep;
- the interrupted attempt is closed before recovery;
- wake starts exactly one fresh generation;
- a delayed completion from the interrupted generation is rejected; and
- immediate repeated runs produce identical lifecycle metrics.

Run:

```sh
node --test scripts/task20-sleep-network.test.mjs
```

This is a virtual lifecycle boundary. It does not claim native Electron power
event integration, operating-system network notifications, physical sleep/wake
execution, or real transport recovery.
