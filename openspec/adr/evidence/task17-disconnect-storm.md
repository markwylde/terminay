# Task 17 disconnect and revocation storm evidence

`packages/server-core/test/remote-disconnect-storm.test.mjs` exercises the
server-owned headless lifecycle with multiple authenticated sessions for one
device. It proves that device revocation closes every session, closes all four
traffic channels, removes the peers from the manager, rejects a new admission
for the revoked device, and remains idempotent when close is repeated.

The same test closes one channel on each of several sessions concurrently and
proves that channel loss tears down the complete session without retaining a
peer. This is deterministic lifecycle evidence only; it does not claim real
browser, hosted, mobile-background, or TURN-network execution.
