## 1. Terminal service hold

- [x] 1.1 Add the `TerminalInactivityHold` interface and the optional `inactivityHold` option to `packages/server-core/src/terminalService/types.ts`, exported from the package index. Verified by the server-core typecheck passing.
- [x] 1.2 In `TerminalService`, check the hold when a waiter's timer fires and leave a held waiter outstanding; subscribe to the hold source and re-arm timer-less waiters for their full duration when their session is released; unsubscribe on dispose. Verified by the unit tests in 1.3.
- [x] 1.3 Add unit tests with the fake inactivity timer covering: no hold source behaves as before; a held waiter does not resolve; release restarts the full period; output during a hold; a hold on another session is ignored; cancel while held; terminal exit while held; a throwing hold source does not break output. Verified by those tests passing under node:test.

## 2. Agent adapter and wiring

- [x] 2.1 Add an adapter in `packages/server-core/src/activity/` that reports whether any live root agent entry bound to a terminal session is `working` and emits a session id only when that answer changes. Verified by unit tests over `working`, `waiting`, `blocked`, `done`, `idle`, inactive entries, and a second terminal.
- [x] 2.2 Pass the adapter as `inactivityHold` where `TerminalService` is constructed in `packages/server-core/src/composition.ts`. Verified by a test in which a working agent holds `waitForInactivity` and its completion releases it.

## 3. Verification

- [x] 3.1 Run the server-core unit suite, lint, and typecheck. Verified by all three exiting zero.
- [x] 3.2 Run `openspec validate --all`. Verified by it reporting no errors.
