I found two renderer bugs and one connection-level regression risk worth fixing. Everything else I checked holds up.

**Issues**

1. **Input can stay paused with no notice (high confidence).** If input overflows while a write is still in flight, and that write then ends with an unknown outcome, the unknown-outcome notice replaces the overflow notice. That code path (`src/components/terminalPanelInputQueue.ts:290-297`) never clears `overflowPaused`. Its button is Dismiss, which only calls `resumeInput()` for overflow (`src/components/TerminalPanel.tsx:3303`). After Dismiss, every key is dropped and nothing on screen says why. This is the same held-write-then-overflow setup the new E2E uses, followed by a connection replacement. Fix: clear `overflowPaused` in the unknown-outcome branch, since pending input was already discarded there.

2. **Overflow can hide a real transport failure (medium-high).** `interruptOverflow()` calls `discardPending()`, which bumps `attachmentGeneration` (`terminalPanelInputQueue.ts:208-213`). If the in-flight write then fails on the *current* attachment, the check at `:278` thinks the attachment was replaced:
   - A transport error is swallowed: no `close()`, no `onError`.
   - An `unknown_command_outcome` shows a notice instead of failing the panel.

   Fix: on overflow, discard the items and zero `queuedBytes` without bumping the generation.

3. **Bursty clients now get disconnected instead of slowed (medium).** The read loop's `inFlight >= 64` wait is gone (`packages/server-core/src/connection.ts:282-288`). Admission now closes the connection once 64 requests are running and 256 are queued (`:358-363`). `client-core` `sendRequest` has no cap on outstanding requests (`packages/client-core/src/client.ts:336`). So a real burst gets a `resource` disconnect where it used to just slow down: many panels hydrating at once, an MCP batch, or long-running requests filling the 64 slots. Fix: either cap in-flight requests in `client-core` below the server limit, or advertise the limit in the hello.

4. **A stuck counter can hang retries (low).** In `packages/server-core/src/dispatcher.ts:210-267`, `ledger.pending++` and `complete()` have no `try/finally`. Any throw outside the handler's try block would leave `pending` raised and `completion` never settled. Waiters with the same `commandId` would then hang until their deadline. A `try/finally` fixes it.

5. **Larger writes may now be refused (verify).** Macro, automation, window-message and dictation writes now pass through the adapter's 256 KiB per-session queue (`packages/server-core/src/terminalService/inputSources.ts:194`). Single writes above that, which used to succeed, now fail with `queue_overflow`. Check what each source's maximum payload is.

Minor: a stale notice survives Retry, which recreates the queue (`TerminalPanel.tsx:2130`). And `MAX_DISPATCHERS` eviction is dead code, because each connection creates its own dispatcher (`connection.ts:156`).

**Checked and holding**
- **Holder retention:** `within-bound-keep-last` matches the old `length > 1` loop, and `ringBytes` is still correct where it is read.
- **Canonical JSON:** parser and `assertJsonValue` count depth the same way.
- **Recording decoders:** flushed in `finalize`, which `stop` and `shutdown` both go through, and kept per recording.
- **Input-source permissions:** `parseSource` (`packages/server-core/src/terminalService/protocol.ts:1936`) stops remote clients from claiming `automation` or `window_message`.
- **Commands:** duplicate correlation and the `executed` gate on delivery credit are right.
- **Queue teardown:** queued requests are released on every teardown path.
- **Acknowledgement coalescer:** trailing and `clear()` semantics are right.

**Test gaps**
- Overflow followed by an unknown outcome, then Dismiss.
- A transport error on the current attachment after an overflow.
- A realistic burst of more than 320 requests from one desktop client, such as many panels plus MCP.
- A handler that throws outside its try block, to exercise the dispatcher counter.

Plan mode asked for a plan file, but I had no tool to write one, so this review is the whole deliverable. I made no edits.
