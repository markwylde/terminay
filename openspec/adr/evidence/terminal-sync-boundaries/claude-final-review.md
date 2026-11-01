No high-severity defects are left in this diff. I found one real misclassification bug with a narrow trigger, two low-severity defects, two UI dead-ends that clear themselves, and two speculative liveness concerns. Everything below comes from reading the source, tests and evidence; I made no edits, wrote no plan file and ran no commands.

## Definite bugs

**1. A request that was never sent now looks like an ordinary failure, not a disconnect. Medium-low severity, high confidence in the mechanism.**
- **Where the error comes from:** a request that was still waiting in local admission when the client closes or loses its transport now fails with `ClientError('unavailable')`. That happens at `packages/client-core/src/requestAdmission.ts:106-117` and `packages/client-core/src/client.ts:351`.
- **What misreads it:** existing code that classifies a disconnect only checks for `ClientDisconnectedError`, `CommandOutcomeUnknownError`, or the codes `disconnected` and `unknown_command_outcome`:
  - **Unsubscribe:** `client.ts:86-90` (`isExpectedDisconnect`). An `events.unsubscribe` caught waiting in the queue is rethrown at `:276-279`. The abort path calls it as `void unsubscribe()` at `:282`, so the result is an unhandled rejection.
  - **Project creation:** `src/workspace/projectCreationRecovery.ts:31-46` (`isConnectionLoss`). The interrupted create step resolves to `fail` instead of the connection-loss recovery path, which checks the snapshot and then continues or resends.
  - **Server upgrade:** `src/workspace/serverUpgradeModel.ts:832-835`. A start request that never left the client is reported as plain refused. That result happens to be correct, but only by accident.
- **When it happens:** only when 128 requests are already outstanding, or the byte budget is used up, at the moment of disconnect. It is rare, but it is exactly the burst-plus-reconnect case this PR targets.
- **Fix:** add a dedicated error type, for example `RequestNotSentError extends ClientError` with `sent: false`, and recognise it in `isExpectedDisconnect` and `isConnectionLoss`. The renderer input queue already treats it correctly: `terminalPanelInputQueue.ts:423-427` only treats `unknown_command_outcome` and `invalid_response` as uncertain, so a replaced attachment still resends once.

**2. Abort reasons are passed through raw. Low severity.**
- `requestAdmission.ts:29-32` and `:77-81` reject with `signal.reason` as given.
- The send path normalises it with `abortError()` (`client.ts:62-65`), turning anything that isn't an `Error` into an `AbortError` `DOMException`.
- So `abort('x')` (or any non-`Error` reason) now rejects with something that isn't an `Error`, but only while the request is waiting in the queue. Callers that check `name === 'AbortError'` behave differently there.
- **Fix:** reuse `abortError(signal)`.

**3. A zero-byte holder buffer orphans a PTY. Low severity; not reachable with the defaults.**
- The holder constructor only checks that `maxBufferBytes` is a safe integer (`packages/server-core/src/sessionHolder/holder.ts:217`).
- `BoundedChunkQueue` throws when the value is ≤ 0 (`boundedChunkQueue.ts:41`).
- That throw happens at `holder.ts:667`, after `nodePty.spawn` has already run at `:653`. With `maxBufferBytes: 0`, every spawn fails and leaves the PTY behind. The old array accepted 0.
- **Fix:** require a positive value in the constructor.

## Low-severity UI issues

**4. A notice can be dismissed while input is still blocked.** Both cases clear themselves once hydration finishes.
- **Uncertain-outcome notice:** its Dismiss button always hides it (`TerminalPanel.tsx:3304-3307`). While `waitingForHydration` is still set, `enqueue` and `enqueuePaste` keep returning false or doing nothing (`terminalPanelInputQueue.ts:91`, `:121`). The panel ignores those returns (`TerminalPanel.tsx:1343-1346`), so keys are dropped with no visible reason until the replacement takes control.
- **Overflow notice:** "Continue typing" does nothing while the role is `pending` or `read_only` (`terminalPanelInputQueue.ts:217`).
- **Fix:** keep the notice, or show a "waiting for terminal" state, until `resumeInput()` or hydration would actually accept input.

## Speculative concerns

**5. A huge client burst can still permanently fail a terminal panel.**
- `requestAdmission.ts:47-56` rejects with `resource` once 4,096 requests are waiting or 16 MiB is queued.
- A `terminal.input` on the current attachment that gets this rejection goes through `close()` and `onError` (`terminalPanelInputQueue.ts:286-289`), so the panel fails for good.
- The design explicitly avoids this ("would instead fail that panel"). Before this PR the client never refused locally.
- **When it happens:** more than 4,224 requests in flight from one client, for example a folder scan plus MCP.
- **Fix:** have the input queue treat a pre-send `resource` refusal as an overflow (show the notice and pause typing), not a fatal error.

**6. Admission is strict first-in, first-out, so one large frame blocks everything behind it.**
- If the oldest waiting request is large (for example the 8 MiB clipboard-image body from `materializeClipboardImage`), it waits for byte budget and holds back keystrokes and `terminal.ack` until responses come back.
- This is bounded and intentional, but it is a latency cliff for typing.

## Checked and holding

- **Admission accounting:**
  - Slots and bytes are released exactly once (`released` guard).
  - Abort, deadline and `clear()` each remove a waiter exactly once, and drain after removal.
  - A waiter resolved just before teardown is caught by the state check at `client.ts:351`.
  - A late abort is caught by `preAbort` at `:387`.
  - The client uses one instance per connection (the reader is never restarted), so requests cannot cross generations.
  - Re-encoding with the remaining deadline can only make the frame shorter.
  - Requests the server has queued are always a subset of what the client counts as outstanding, so `TerminayClient` cannot reach the server's safety ceiling.
- **Server feature queue:**
  - Ping and cancel bypass it.
  - Original deadlines are kept, cancelling a queued request removes it, and duplicate correlation IDs are rejected.
  - The active-slot counter is incremented synchronously during drain.
  - Every teardown path clears the queue.
  - The dispatcher limit of 64 pending commands cannot trip, because the connection is the only caller.
- **Command ledger:**
  - Fingerprints match the old depth behaviour.
  - Completion settles in `finally`.
  - Replays never reapply delivery credit (`executed` gate).
  - Eviction only drops completed entries.
- **Renderer input queue:**
  - Overflow no longer bumps the attachment generation, and the current-attachment failure tests cover that.
  - Retained paste bytes are released on every path, including an in-flight cancel and `close()`.
  - The uncertain-outcome path clears the overflow pause.
- **Input routing:**
  - Every new caller passes an authorization whose `clientId` is either absent or matches.
  - `parseSource` (`terminalService/protocol.ts:1936`) still stops remote clients claiming `automation` or `window_message`.
  - Dictation now gets the stricter project-identity check, which is correct.
- **Recording decoder:** each recording owns its decoder, it is flushed in `finalize`, and no string-based output callers remain.
- **Holder ring:** retention matches the old rule (always keep the newest chunk), including bounds smaller than one chunk.
- **Canonical JSON:** depth checks are the same as before, and the parser limit matches `assertJsonValue`.
- **Acknowledgement coalescer:**
  - The send function is read through a ref, so a trailing acknowledgement uses the current client.
  - `clear()` only drops unsent trailing work.

## Coverage gaps

- **Unused-path tests:** no test sends dictation input (`cli.ts:964`, `serverTerminalAuthority.ts:993`) or standalone or embedded macro input (`cli.ts:1203`, `electron/main.ts:2259`) through the composed adapter.
- **End-to-end resend:** no test covers a `terminal.input` stuck in local admission at disconnect, where the renderer queue then resends it exactly once on the replacement. Each half is only tested on its own.
- **Abort race:** no test covers a waiter that is admitted and then aborted before it sends.
- **Read-only with a notice:** no test covers a read-only replacement arriving while an overflow notice is showing (finding 4).
- **Holder buffer:** no test covers a holder constructed with a buffer of 0 or less (finding 3).

## Follow-up disposition

The owner authorized specifying and fixing the confirmed findings. The follow-up adds a distinct RequestNotSentError recognized by cleanup and project recovery; shared AbortError normalization; positive-safe-integer holder configuration validation before resource creation; and readiness-aware input interruption actions. Tests cover actual SDK admission plus renderer handoff exactly-once resend, abort after grant before send, unsent subscription cleanup, cancellation reason variants, project recovery classification, invalid holder bounds, and pending/read-only notice state. No FIFO bypass, automatic uncertain-input retry, or higher queue limit was introduced. The speculative extreme-burst refusal and FIFO latency observations remain bounded trade-offs, not demonstrated synchronization corruption.
