# Independent review: Terminay terminal synchronization audit (1 Nov 2026)

**Overall:** The audit's architecture and "what I would keep" sections are right. Three of its premises are wrong, though:

- **Finding 1 is not a stray test.** It is the intended behaviour of an active change that is fully implemented but not yet archived.
- **The ADR basis is out of date.** ADR-0035 is no longer the current holder decision.
- **The server input adapter does almost nothing in production.** In holder mode it provides no real ordering or backpressure.

Several findings are stronger than the audit says, and two are weaker. I didn't write the plan file or call ExitPlanMode because those tools weren't available to me. Everything below comes from read-only inspection.

---

## 1. Verdict on each finding

### F1: uncertain write during handoff. **Agree, but it is intentional and still waiting on a decision.**

- **It is deliberate.** `openspec/changes/terminal-input-survives-attachment-handoff/` has every task checked off. Its `design.md:65-88` explicitly accepts the risk of continuing after an unknown outcome, and its delta (`specs/terminal-workspace/spec.md:22-25`) requires it.
- **Archiving it as-is would put a contradiction into the main specs.** The new requirement conflicts with `terminal-stream-congestion-and-recovery/spec.md:474`. `openspec validate` will not catch that.
- **It is narrower than the audit implies.** `unknown_command_outcome` only comes from `ClientDisconnectedError` (`client-core/src/client.ts:230`). So it happens only on a rebind after the transport is lost, never during congestion recovery or a refused resume on a live connection.
- **The danger is a gap, not reordering.** `terminal.input` checks that the attachment is current and that it holds the presentation before writing (`terminalService/protocol.ts:1280-1295`). An old frame therefore can't land after the replacement's writes. What can happen is that a lost keystroke or a 16 KiB paste chunk is followed by `\r`, so the shell runs a different command than the one typed.
- **Verdict:** Fail closed, but only for that case. Keep the change's preservation for definitive outcomes; that covers almost all of its user value.

### F2: holder ring wrap and adoption. **Agree, and it is broader than stated.**

- **Starting from position 0 is not a correct oracle either.** The holder ring stores bytes but not resize history: resize goes straight to `child.resize` at `holder.ts:582-586`. Replaying the full stream at the final size is not equivalent if the terminal was resized along the way.
- **Ring wrap is the normal case.** The default ring is 1 MiB (`holder.ts:55`), so any busy, long-lived session will have wrapped by the time of an upgrade.
- **Partial mitigation (needs a test to confirm):** a client that stays mounted and resumes from a rendered position at or after `taken.from` should keep its correct xterm. Damage then falls on new devices and on fresh-presentation recovery.
- **Recovery can make a correct screen worse.** A congestion skip after a restart can replace a correct screen with the incomplete reconstruction.
- **ADR constraint:** ADR-0035 §4 ("parses no terminal output") and §5 ("a running attached session is never journalled") carry forward unchanged through 0077 → 0083 → **0086**, which is the current decision. Both "holder-owned presentation" and a persisted checkpoint require superseding ADR-0086.

### F3: sources bypassing `TerminalInputSourceAdapter`. **Agree there is spec drift; disagree on severity and on the reason given.**

- **The ordering gap is effectively nil in production.** Holder writes are fire-and-forget (`sessionHolder/client.ts:334`, `factory.ts:544`), so `service.input` resolves within a microtask. The probe's "held write" can't happen in holder mode, and the adapter's aggregate bound covers almost nothing.
- **No stdin backpressure exists anywhere end to end.** The path is `socket.write` into node-pty's buffer.
- **Routing everything through the adapter would not make pastes atomic.** The renderer keeps one paste chunk in flight, so any other source can interleave between chunks.
- **Composition-level callers can't reach the adapter today.** By default it is constructed inside protocol registration (`protocol.ts:220-221`).
- **Its recording hook isn't wired in production.** `onInputAccepted` is only used in tests (`test/terminal-input-sources.test.mjs:82`).
- **Severity:** P3 (consistency). Route all sources through it for one attributed boundary, but don't present that as an ordering or backpressure fix.

### F4: silent refusal and the uncapped paste queue. **Agree.**

- `TerminalPanel.tsx:1339` ignores the `false` return, and so does the small-paste branch at `terminalPanelInputQueue.ts:111`.
- Large pastes are never counted in `queuedBytes`.
- Read-only refusal also returns `false`, but the control bar already makes that case visible. The overflow indicator should say which refusal happened.

### F5: concurrent command ledger. **Agree, with two consequences the audit missed.**

1. **A replayed result can hang the request.** The replay carries the original `correlationId` (`dispatcher.ts:161`). The connection routes responses by correlation, so a same-connection duplicate waits until its deadline instead of getting the cached answer.
2. **A reused commandId can skip validation.** `applyTerminalDeliveryCommand` reads `position` from the new request's payload (`connection.ts:760-766`), even when the dispatcher returned a cached result without running the handler. Reusing a commandId with a different `terminal.ack` position therefore moves outbound credit forward without the handler checking it.

Also: the ledger is per connection (`dispatcher.ts:153`), so `commandStatus` can never resolve an unknown outcome after a reconnect. The normal client generates unique IDs (`client.ts:217`), so this needs a misbehaving client and only affects that client's own connection.

### F6: inbound saturation. **Agree, and it is worse than reported.**

- **The server hangs up on a live client, not just the client giving up.** The server's own heartbeat deadline is only re-armed when a frame is read (`connection.ts:260`, `:382-411`, default 60 s). A blocked reader therefore causes the server to drop a live client.
- **The client gives up first.** It pings every 10 s and allows 2 misses (`src/web/sessionConnectAttempt.ts:343-345`), so it gives up after roughly 20–30 s.
- **It feeds into F1.** The resulting reconnect turns in-flight writes into unknown outcomes.
- **What triggers it:** `terminal.input` finishes almost immediately in holder mode, so saturation needs 64 long-running handlers. Queries with no deadline (file, git, AI) make that plausible.

### F7: recording UTF-8. **Agree, and there is an easy efficiency win.**

- **Every session pays the decode cost, recorded or not.** `composition.ts:1704-1709` decodes every output event for every session; whether a recording is active is only checked later, inside the service.
- **There is a third copy.** `serverTerminalAuthority.ts:2759` decodes per event as well, but it is only reached through the `TERMINAY_TEST` IPC seam (`main.ts:7204-7221`). It is not a live-screen bug.

### Performance items

- **Holder ring deque:** Agree. It is ADR-0044 hygiene, and I expect only a small user-visible effect. The benefit only reaches new holder generations, because generations are frozen.
- **JSON double validation:** Agree, with a trap described in §4 below.
- **Attention acknowledgements:** Agree that they duplicate. Every keystroke (`terminal.onKey`, `TerminalPanel.tsx:2204`) sends an activity ack plus an agent ack (`App.tsx:2346-2361`), so typing costs **3 commands per key**. Don't merge them into one server operation yet:
  - the activity ack is sent unfenced (`fence: false`);
  - the agent ack only runs when the agent-integration setting is on, and the server rejects it if the agent service isn't active (`agentService.ts:273-291`).

---

## 2. Low-risk implementation advice and regression tests

**F1. Amend the active change before archiving it.**
- In `terminalPanelInputQueue.ts:250-255`: when an unknown outcome settles on a replaced attachment, drop all queued items, including those typed during the handoff. Cancel an active paste through `onProgress`. Accept input again once the current attachment is a hydrated controller.
- **Do not call `close()`.** It permanently fails the panel.
- Raise an "input after an interrupted write was not sent" notice.
- Rewrite the test at `scripts/terminal-panel-input-queue.test.mjs:477` to expect no `b` and one notice, and add "input typed after the settle is delivered".
- Keep the definitive-refusal test at `:456` unchanged.
- Add a MODIFIED delta to the congestion requirement so the three cases are explicit: refused, delivered, and unknown.

**F4.**
- Make `enqueue` and `enqueuePaste` return one of `accepted`, `overflow`, `read_only` or `closed`, and have the panel flash a non-modal overflow message.
- Cap pending large-paste bytes, or allow only one pending large paste and refuse any further one visibly.
- **Tests:**
  - fill 64 KiB, then check that the refusal is reported;
  - with three large pastes, the third is refused;
  - order and UTF-8 chunk boundaries are preserved.

**F5.** In `CommandLedger`:
- Record in-flight entries keyed by `commandId` plus a hash of operation, canonical payload and body.
- If the same request arrives while one is in flight, await its result. If the payload differs, return an error.
- Re-stamp the cached result with the current request's `correlationId`.
- Have the dispatcher return an `executed` flag, and only call `applyTerminalDeliveryCommand` when it is true.
- **Tests:**
  - two concurrent identical requests produce one execution and two responses with the correct correlations;
  - reuse with a conflicting payload is rejected;
  - a replayed `terminal.ack` does not move outbound credit.

**F6.** Change `readLoop` so it never stops reading:
- Call `noteInboundFrame` on every frame.
- Handle `cancel` and `connection.ping` immediately, without going through the in-flight gate.
- Hold feature frames above 64 in flight in a FIFO bounded by bytes and frames. If that FIFO overflows, fail the connection; spec line 493 already allows closing a genuinely failed transport at the final safety ceiling.
- **Don't** reply to over-limit feature requests with a `resource` refusal. On the current attachment, the renderer queue treats any non-ownership refusal as fatal (`terminalPanelInputQueue.ts:246-249`).
- **Tests:**
  - with 64 held queries, a ping is answered and a cancel aborts one of them;
  - with a fake clock, the server heartbeat does not fire while frames are still arriving;
  - FIFO overflow closes the connection with a diagnostic.

**F7.**
- Add `appendOutputBytes(sessionId, bytes)` to the recording service. It returns early when nothing is recording. Each active recording keeps its own `TextDecoder` and calls `decode(bytes, {stream: true})`.
- Flush the decoder before writing `x`, and on stop, finalize and shutdown. Use a fresh decoder for each recording.
- Use it in both `composition.ts:1704` and `electron/main.ts:1841`.
- Document that a recording started mid-character begins with one U+FFFD.
- **Test:** split `€` and a 4-byte emoji at every byte boundary, plus exit and stop while a partial character is buffered.

**Holder ring.**
- Use `BoundedChunkQueue` (`terminalService/boundedChunkQueue.ts`) with a guard that always keeps the newest chunk, matching the existing `ring.length > 1` rule at `holder.ts:765`. Plain `within-bound` can evict everything when `maxBufferBytes < 64 KiB`.
- Confirm the holder bundle includes it. The holder already imports `../durableFile.js`.
- **Tests:**
  - an equivalence check against the old array using random chunk sizes, comparing `bufferedFrom`, adopt replay bytes and tail bytes;
  - the fine-versus-coarse scaling guard already used for `TerminalService`.

**JSON validation.**
- Split `canonicalize` into an exported function that validates once and an internal recursion that doesn't re-validate.
- Hoist the `schemas` and `required` maps in `types.ts:71-93`; today they are allocated on every call.
- Give `StrictJsonParser` a depth limit of 32.
- Replace `slice().match` in `parseNumber` with a sticky regex.
- **Test:** a differential corpus plus malformed-frame fuzzing, requiring byte-identical encoding and identical accept/reject results.

**Attention acknowledgements.**
- Coalesce per session and per kind (activity or agent), keeping passive and interactive acks separate: at most one in flight plus one trailing.
- Semantics are unchanged except that an ack may land up to one RTT later. That's acceptable because the activity ack is already unfenced.
- **Don't deduplicate against the projection snapshot.** A stale snapshot means a needed ack gets skipped.
- **Measure:** commands per keystroke, which should fall from 3 to about 1.

**F3.**
- Construct one adapter in the composition and pass it to protocol registration.
- Route macros, dictation, automation, window messages and the host write path through it with their own source identities. Any of those sources missing from the adapter's `SOURCES` list needs adding; window messages and automation are the obvious ones.
- **Test:** the composed server's macro, automation and window-message paths reach the adapter, checked with a spy on the composed instance.

---

## 3. Do now vs. needs a separate proposal

**Now, in order, with what to measure:**
1. **F7:** correctness, plus removing a decode on every output event.
2. **Attention-ack coalescing:** about 3× fewer command frames per keystroke.
3. **F6:** reader restructure.
4. **F5:** ledger fixes.
5. **F1:** amend the change, then archive.
6. **F4.**
7. **Holder deque:** lands with the next holder generation.
8. **JSON micro-optimizations:** only with before/after numbers.
9. **F3:** composition hygiene.
10. **Specs:** a spec-only change bringing `terminal-workspace/spec.md:400-408` into line with congestion `:97`, fixing the `client-core/src/terminal.ts:342-349` comment, and rewriting `terminal-workspace:552-559` so it doesn't promise PTY backpressure that holder mode doesn't provide.

**Needs a separate proposal and ADR:**
- **Presentation continuity across restart.** This supersedes ADR-0086 §4/§5. It has to cover resize history and the crash path, not just graceful handoff.
- **Exact resolution of uncertain input.** Use the adapter's existing per-client/source `sequence` (`inputSources.ts:200-210`): clients send it, the server keeps the last accepted value across reconnect instead of clearing it in `releaseClient`, and a query exposes it. That turns "unknown" into "known" and removes F1's tradeoff entirely.
- **End-to-end stdin backpressure.** Credit-based flow between holder and PTY, which bumps the holder protocol version.
- **A single fenced attention operation**, if coalescing turns out not to be enough.

---

## 4. Dangerous assumptions in the audit

- **F1 is treated as a test that contradicts the spec.** It is an implemented change that would fold the contradiction into the main specs when archived.
- **ADR-0035 is treated as current.** The holder decisions now live in ADR-0086 (through 0077 and 0083). ADR-0054 moved the holder socket out of the data root, ADR-0055 governs locking, and ADR-0088 makes holder records rebuildable. The audit's "holder-owned presentation state" directly violates the current §4.
- **The adapter is assumed to provide ordering and backpressure.** It doesn't in holder mode, and no stdin backpressure exists anywhere.
- **The proposed end-to-end oracle assumes replaying the uninterrupted stream gives the right answer.** It also has to replay the resize sequence.
- **Heartbeat starvation is framed as a client-side symptom.** It is also the server dropping a live client.
- **The JSON trap:** the assertion repeated inside `canonicalize` at each level (`json.ts:22`, invoked at `:16`) is **the only depth limit on decode**. The parser recurses without any limit, and `validateEnvelope` checks payload depth from depth 0. Removing the "redundant" checks without adding a parser depth limit removes nesting protection.
- **`commandStatus` is implied to work for recovery.** Because the ledger is per connection, it can't resolve outcomes after a reconnect.
- **Benchmark gains are presented as immediate.** Holder changes don't reach sessions in existing generations; existing sessions keep the old holder code until they end.
