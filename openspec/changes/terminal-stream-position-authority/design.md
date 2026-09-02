# Design

## Context

The failure was reproduced deterministically: a renderer stops acknowledging, the producer emits roughly 400 KiB, the attachment's lane exceeds `maxTerminalUnconfirmedBytes`, the backlog is discarded, and one `resync_required` is emitted with a `replayFrom` computed at that instant. The client re-attaches with `freshPresentation: true`, which succeeds against a checkpoint at position 295943 while the PTY has already advanced to 409624, so live output resumes at 409607 and the client rejects every later frame as a replay gap. The transport is healthy throughout, and a terminal created after connecting streams fine on the same connection.

The reason this survived several attempted fixes is that the positioning violation was swallowed twice. The service adapter threw on a gap and the terminal subscription's delivery caught and discarded it so a listener could not break PTY supervision; the client caught the same gap into a `hydrationFailure` field that nothing reads again once `open()` has returned. No error surfaced anywhere.

Six components independently tracked stream position:

1. The terminal service's session `outputPosition`/`replayFrom` — the actual truth.
2. The service adapter's `highWatermarks` and `deliveredPosition`, with contiguity throws that were swallowed.
3. The protocol layer's checkpoint `headPosition` used as the attach `fromPosition`, whose close sink fabricated a `resync_required` with all three fields set to the current head.
4. The outbound delivery pump's per-lane `confirmedPosition`/`headPosition`, where congestion discarded the backlog and the resync frame's `replayFrom` was the lane head at discard time rather than at the client's consume time.
5. The connection's `terminalOutputPositions` duplicate-delivery guard, advanced before the pump accepted or dropped the frame.
6. The client's `mutable.position` and `highWatermarks`, whose `acceptEvent` was the only enforcer of contiguity and enforced it by throwing.

Three of those — pump discard, checkpoint hydration boundary, and watermark resume — could each independently create a discontinuity. Exactly one enforced contiguity, and did so unobservably. Coordination between them was an out-of-band promise with a time-of-check/time-of-use window, which is why the same symptom appeared from the congestion path, the checkpoint path, and the reconnect-resume path.

## Goals / Non-Goals

Goals:

- One owner of position per hop, and one component permitted to drop bytes.
- Discontinuity represented only as an ordered marker inside the same stream as the data it replaces.
- No latch whose exit depends on the client acknowledging bytes the server refused to send.
- Every positioning fault observable at the boundary that detects it.

Non-goals:

- Connection and transport lifecycle, which the preceding connection-lifecycle change owns and which is not touched here.
- Presentation leases, input sources, checkpoint authority internals, recording, and the WebRTC runtime.
- Backwards compatibility with the old wire event. Desktop, browser, and server ship together.

## Decisions

**Three position owners, one per hop.** The terminal service's session `outputPosition`/`replayFrom` stays the canonical stream authority, unchanged. The per-attachment lane in the outbound delivery pump becomes the sole authority for what has been delivered on the wire: it gains `sentPosition`, the end of the last terminal frame actually transmitted, alongside `headPosition`, the end of the last frame admitted or skipped. It is the only component permitted to drop bytes. The client's `position` becomes a passive mirror advanced only by `output.nextPosition` and `skip.toPosition`. Every other tracker is deleted.

**Discontinuity is explicit, in-band, and server-authoritative.** `resync_required` is replaced by `{ type: "skip", fromPosition, toPosition, reason }` emitted inside the lane's FIFO exactly where the dropped bytes would have been. `fromPosition` is the lane's post-discard `sentPosition`, or the retained active delivery's `nextPosition` when one is in flight; `toPosition` is the lane head. Because the marker travels in the same ordered stream as the data, there is no time-of-check/time-of-use window. Alternative considered and rejected: keeping the advisory and re-validating it at consume time, which narrows the window without closing it and leaves three producers of the same undetectable condition.

**Suppression is a lane state with an attachment-replacement exit.** After emitting one skip the lane is `suppressed`: later admissions resolve and drop, and the protocol layer stops publishing for that attachment. The only exits are `releaseTerminal` — driven by `replacedAttachmentId` on attach or by `terminal.detach` — and connection close. This preserves the stalled-renderer bound of exactly one congestion callback and one skip frame on the wire per congested attachment. The two earlier acknowledgement-based exits are symptoms of the same flaw and are superseded rather than preserved, because they asked the client to acknowledge bytes it was never sent.

**The client never throws on the stream and never dies silently.** On a skip it advances `position` to `toPosition`, collapses pending acknowledgements, and notifies listeners; the renderer's existing resync-to-fresh-checkpoint re-attach loop is the sole recovery path. A genuine contiguity violation on output is a server bug and closes the attachment with an observable error event. Because `position` has already advanced, recovery is idempotent.

**Attach cursors are always explicit.** Watermark resume memory is removed from the adapter and the client. A reconnect passes the exact rendered position or requests a fresh presentation, which removes the third independent discontinuity creator. `terminal.resume` becomes an alias with no memory, and an omitted `fromPosition` means 0.

**Dedupe moves into the lane.** The connection's `terminalOutputPositions` map is deleted. Lane admission drops a frame ending at or before the head as a duplicate, and treats a frame starting beyond the head as a server-side ordering violation that congests with a skip.

**Everything upstream of the lane is kept.** The service's contiguous position and replay-ring model, the checkpoint authority's parser-safe pin design, lane-per-attachment fair scheduling with its byte, frame, and age bounds, and the fresh-presentation binary checkpoint query protocol are correct. The defect was entirely in how discontinuity was communicated.

Why this eliminates the class rather than the instance: after the change, resume can no longer manufacture a cursor, hydration's checkpoint head is contiguous by construction or fails loudly, and discard is representable only as an in-band skip. No code path can advance the wire past the client's position without telling it in order.

### Security and architectural boundaries crossed

The change touches the terminal-session boundary, which is a security boundary for remote access, MCP, recordings, and agent status. Skip markers are scoped to the exact `{serverId, projectId, sessionId, clientId, attachmentId}` attachment identity, carry no terminal content, and are authored only by the server. The client remains a passive mirror with no authority to invent a position, so a compromised or buggy client can obtain no bytes it was not delivered.

## Risks / Trade-offs

- `sentPosition` arithmetic around a retained in-flight delivery is the riskiest arithmetic in the change → pinned by a skip-exactness invariant that covers the retained-delivery case explicitly.
- After a skip, no further acknowledgements are sent for the doomed attachment → detach's final flush is verified not to publish a position inside the skipped range.
- Removing the connection-level dedupe map assumes nothing relies on duplicated terminal events across overlapping subscriptions → the lane's own dedupe covers the case the map existed for, and the overlapping-subscription test still passes.
- A producer that outruns the client forever yields a visible skip and recover cycle at the retry cadence. That is the intended convergence behaviour, but the cadence and checkpoint pin churn under a maximal-rate producer on a slow link remain unproven by load test.
- Checkpoint lag is bounded but not eliminated: `MAX_CHECKPOINT_CATCHUP_BYTES` is a fixed 128 KiB rather than a value derived from the connection's configured lane limits, so a host that lowers `maxTerminalUnconfirmedBytes` below that could still hydrate into congestion.

## Findings that changed the plan during implementation

1. `resync_required` had two unrelated meanings. Besides the terminal event, it is the projection-subscription resync `kind` used by git, activity, and agent status, and the client error code for subscription overflow. Only the terminal event is replaced; the subscription mechanism is untouched.
2. The reason recovery never converged was not in the congestion path at all. The terminal service throttles how fast it feeds the checkpoint authority at 256 KiB, the same order as the lane's unconfirmed-bytes bound, so under sustained output a prepared checkpoint's head sat far behind the live head and hydration replayed that difference through the presentation lane, re-congesting it immediately. Every recovery attempt re-armed the failure. This is now bounded by a catch-up limit deliberately below the lane bound; past it the stream starts at the live head and the intervening range is an ordered skip.
3. Retained replay is bounded, so a fresh attach can legitimately begin after the cursor it asked for. That is a server-known discontinuity, so the adapter states it as a skip instead of treating it as a fault.
4. Skip is monotonic rather than strictly contiguous. An attachment-closed skip is journalled and travels the state lane, so it can overtake terminal-lane output; requiring exact contiguity there would turn benign ordering into a spurious fault. Strict contiguity is enforced on output, which is where corruption shows up.
5. `closeForOverflow` has no external consumers — it is used only by the pull-subscription enqueue path — so it was kept and converted to emit a skip.

## Follow-up: the hydration recovery loop

Deploying the change surfaced a defect it introduced. A fresh presentation whose checkpoint trailed the live head was delivered with a skip describing the difference, and the panel treats a skip as an instruction to re-hydrate. That skip arrives inside the attach's own initial events, so hydrating triggered another hydration whose checkpoint trailed by the same amount. The terminal painted once and never again while its connection stayed busy and healthy, with inbound frames and bytes climbing throughout — which is exactly what made it look like a dead stream rather than a loop.

Two things were wrong and both are fixed:

1. A gap established during hydration was indistinguishable from falling behind. The skip reason gains a third value, `hydration`, and a single shared predicate decides what re-hydrates. Re-attaching cannot repair a boundary that re-attaching reproduces.
2. The checkpoint was routinely stale. Output reaches the checkpoint authority through a bounded drain, and only the presentation read waited for it while prepare did not, so every fresh presentation pinned a screen behind by whatever was still queued — around 280 KB under sustained output. Settling a presentation now lets that drain catch up before a checkpoint is pinned, bounded by a deadline so a terminal that never falls silent cannot stall an attach. When the deadline is reached the bounded skip still applies.

The catch-up skip is now a genuine last resort rather than the routine path.

## Migration Plan

Desktop, browser, and server ship in the same release, so the wire event is replaced outright with no dual-support window. The change lands as ordered slices — reproduction tests first, then lane skip semantics, then the protocol and wire event, then client position authority, then the adapter shrink, then deletions — so that each slice leaves the suites green. Rollback is a release rollback of all three surfaces together; a mixed-version pairing is not supported and is not made to appear to work.

## Open Questions

- Permanent overload behaviour: the skip and recover cadence and checkpoint pin churn under a maximal-rate producer on a slow link are unproven by load test.
- Whether the checkpoint catch-up bound should be derived from the connection's configured lane limits rather than being a fixed constant.
