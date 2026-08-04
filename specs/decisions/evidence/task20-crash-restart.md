# Task 20 crash/restart evidence

Date: 2026-07-27

`scripts/task20-crash-restart.test.mjs` exercises the bounded Desktop Local
supervisor lifecycle with deterministic in-memory authorities. Three
successive crashes prove that:

- a concurrent second start coalesces onto the one authority;
- a crashed authority remains in the crashed state until an explicit restart;
- a restart stops the old authority before creating the replacement;
- repeated recovery never has more than one authority active; and
- concurrent shutdown is idempotent and releases the final authority.

This is local lifecycle evidence only. It does not claim Desktop sleep,
network changes, disk-full/read-only recovery, provider failure, signaling or
TURN outage behavior, native packaged execution, or crash recovery of a
running PTY process. Those portions of the broader task-20 reliability gate
remain open.

The focused command is:

```sh
npm run build --workspace @terminay/desktop
node --test scripts/task20-crash-restart.test.mjs
```
