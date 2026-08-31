# 76 — Terminal stream position authority

## Goal

A terminal attachment's byte stream is contiguous by construction, from the
PTY to xterm. Any byte range the server decides not to deliver is represented
by an explicit, in-band, ordered `skip` marker on the same delivery lane —
never by an out-of-band advisory. The client's position only ever advances
(output or skip); it never throws on a gap and never goes silent while its
connection is healthy. The number of independent position trackers drops from
six to three, and the recovery latches that required a second guess
(`resyncPending` ack-exit, `outputSuppressed` ack-exit, watermark resume)
are deleted. Layer 1 (task 74's connection lifecycle) is not touched.

## Root cause analysis (evidence, 2026-08-31)

Reproduced deterministically in
`packages/server-core/test/terminal-congestion-recovery.test.mjs`: renderer
stops acknowledging → producer emits ~400 KiB → lane exceeds
`maxTerminalUnconfirmedBytes` → backlog discarded, one `resync_required` with
`replayFrom` computed at time T → client re-attaches with
`freshPresentation: true`, which SUCCEEDS with a checkpoint at position
295943 → the PTY has meanwhile advanced to 409624 → live output resumes at
409607 → the client rejects every later frame as a replay gap. The transport
is healthy throughout; a terminal created after connecting streams fine on
the same connection.

**The failure is invisible because a positioning violation is swallowed
twice.** `adapter.ts:96-97` throws on a gap; `service.ts:224-226`
(`TerminalSubscription.deliver`) catches and discards it so a listener cannot
break PTY supervision. On the client, `terminal.ts:742-748` catches the same
gap into `hydrationFailure`, which is never read again once `open()` has
returned. No error surfaces anywhere. That is why this survived many
attempted fixes.

Six independent trackers of "where is this stream", no single owner:

1. `terminalService/service.ts` — session `outputPosition`/`replayFrom`
   (the actual truth).
2. `terminalService/adapter.ts:64,83-100` — `highWatermarks` +
   `deliveredPosition`, with contiguity throws that are swallowed.
3. `terminalService/protocol.ts` — checkpoint `headPosition` as attach
   `fromPosition`; the `onClose` sink fabricates a `resync_required` whose
   three fields are all the current head.
4. `outboundDelivery.ts:59-67` — per-lane `confirmedPosition`/`headPosition`;
   congestion discards the backlog and the resync frame's `replayFrom` is the
   lane head **at discard time**, not at the client's consume time.
5. `connection.ts` — `terminalOutputPositions` duplicate-delivery guard,
   advanced before the pump accepts or drops the frame.
6. `client-core/terminal.ts` — `mutable.position` + `highWatermarks`, and
   `acceptEvent`, the only enforcer of contiguity, which throws.

Three of these can independently create a discontinuity (pump discard,
checkpoint hydration boundary, watermark resume). Exactly one enforces
contiguity, by a swallowed throw. Coordination is an out-of-band promise:
`resync_required.replayFrom` is computed at time T and consumed at T+n with
nothing guaranteeing validity — a time-of-check/time-of-use race that
manifests identically from the congestion path, the checkpoint path, and the
reconnect-resume path.

Two earlier patches in this layer are symptoms of the flaw and are superseded
here, not preserved: the ack-based exit for `resyncPending` in
`outboundDelivery.ts`, and the ack-based exit for `outputSuppressed` in
`protocol.ts`. Both require the client to acknowledge bytes the server has
already refused to send it, which no client can do.

## Decisions

1. **Three position owners, one per hop.**
   - `TerminalService` session `outputPosition`/`replayFrom` stays the
     canonical stream authority (unchanged).
   - The per-attachment lane in `OutboundDeliveryPump` becomes the sole
     authority for what has been delivered on the wire: it gains
     `sentPosition` (end of the last terminal frame actually transmitted)
     alongside `headPosition` (end of the last frame admitted or skipped).
     It is the **only** component permitted to drop bytes.
   - Client `mutable.position` is a passive mirror: advanced only by
     `output.nextPosition` and `skip.toPosition`.
   All other trackers are deleted.
2. **Discontinuity is explicit, in-band, server-authoritative.** The wire
   event `resync_required` is replaced by
   `{ type: "skip", fromPosition, toPosition, reason }` emitted *inside the
   lane's FIFO*, exactly where the dropped bytes would have been.
   `fromPosition` is the lane's post-discard `sentPosition` (or the retained
   active delivery's `nextPosition`), `toPosition` its `headPosition`;
   `reason` is `"congestion"` or `"attachment_closed"`. Because the marker
   travels in the same ordered stream as the data, there is no
   time-of-check/time-of-use window. No backwards compatibility: desktop,
   browser and server ship together; the old event type is removed.
3. **Suppression is a lane state with an attachment-replacement exit, not an
   ack exit.** After emitting one skip, the lane is `suppressed`: later
   admissions resolve-and-drop and the protocol layer stops publishing for
   that attachment. The only exits are `releaseTerminal` — driven by
   `replacedAttachmentId` on attach or by `terminal.detach` — and connection
   close. This preserves the stalled-renderer bound: exactly one congestion
   callback and one skip frame on the wire, ever, per congested attachment.
4. **The client never throws on the stream and never dies silently.** On
   `skip`: advance `position` to `toPosition`, collapse pending
   acknowledgements, notify listeners; the renderer's existing
   `beginTerminalResync` → fresh-checkpoint re-attach loop is the sole
   recovery path. A genuine contiguity violation (a server bug) closes the
   attachment with an observable error event to listeners — the
   `hydrationFailure` swallow and both throw sites are deleted. Because
   `position` has already advanced, recovery is idempotent.
5. **Attach cursors are always explicit; watermark resume memory is
   deleted.** `adapter.ts` `highWatermarks` resume defaulting and the client
   `highWatermarks` map are removed. A reconnect passes the exact rendered
   position or requests `freshPresentation`. This removes the third
   independent discontinuity creator.
6. **Duplicate-delivery dedupe moves into the lane.**
   `connection.ts` `terminalOutputPositions` is deleted; lane admission drops
   `nextPosition <= headPosition` as a duplicate and treats
   `position > headPosition` as a server-side ordering violation that
   congests with a skip, never a silent drop.
7. **Everything upstream of the lane is kept.** The service's contiguous
   position/replay-ring model, the checkpoint authority's parser-safe (C, H)
   pin design, lane-per-attachment fair scheduling and its byte/frame/age
   bounds, the `freshPresentation` + binary checkpoint query protocol, and
   task 74's connection-scoped teardown are correct and unchanged. The bug is
   entirely in how discontinuity was communicated.

Why this eliminates the class, not the instance: checkpoint hydration,
congestion discard, and reconnect resume were three producers of the same
undetectable condition — "the next frame's position will not match what the
client believes". After this change (a) resume can no longer manufacture a
cursor, (b) hydration's H is contiguous by construction or fails loudly, and
(c) discard is representable only as an in-band skip. No code path can
advance the wire past the client's position without telling it in order.

## Scope

In scope: `packages/server-core/src/outboundDelivery.ts`, `connection.ts`,
`terminalService/{adapter,protocol,service,types}.ts`,
`packages/client-core/src/{terminal,terminalPanel,types}.ts`,
`src/components/TerminalPanel.tsx`, `electron/serverTerminalAuthority.ts`
event decode, the server-core and client-core suites, and the two specs below.

Out of scope: connection/transport lifecycle (task 74), presentation leases,
input sources, checkpoint authority internals, recording, Werift.

## Implementation slices

### Slice 0 — pin the failure (red tests first)

- `packages/server-core/test/terminal-congestion-recovery.test.mjs`: attach,
  stream, stop acking, ~400 KiB burst → congestion; perform the documented
  recovery (`freshPresentation: true` re-attach through a real
  `TerminayTerminalClient` with `queryWithBody` wired); keep producing during
  hydration; assert the rendered stream reaches the producer head and stays
  live. Red on main.
- Assert both silent-death mechanisms directly: a post-hydration gap is
  swallowed today (`client-core/terminal.ts:742-748`); an adapter contiguity
  throw is discarded today (`service.ts:224-226`). Both become observable.

### Slice 1 — lane skip semantics in the pump (risky)

- Add per-lane `sentPosition`; each terminal `PendingDelivery` carries its
  `nextPosition`; `completeDelivery` advances `sentPosition`.
- `congestTerminalLane`: discard backlog, then enqueue exactly one skip frame
  from `{ fromPosition: retainedActiveDelivery?.nextPosition ?? sentPosition,
  toPosition: headPosition }` via the renamed `createSkipFrame`; set
  `suppressed` (renamed from `resyncPending`).
- Delete the ack-based exit in `acknowledgeTerminal`. `suppressed` clears only
  in `releaseTerminal`.
- Admission: duplicate (`nextPosition <= headPosition`) → drop;
  discontinuous (`position > headPosition`) → congest with skip; suppressed →
  resolve-and-drop.
- Risk: `sentPosition` arithmetic around the retained in-flight delivery.
- Update the stalled-renderer test for the new frame; its invariants are
  unchanged and must still pass.

### Slice 2 — protocol and wire event

- `connection.ts` `sendEvent`: replace the `resync_required` payload with the
  `skip` payload from the pump boundary; delete `terminalOutputPositions` and
  its touchpoints.
- `protocol.ts`: delete the `outputSuppressed` ack exit; suppression enters
  via `suppressOutput` and exits only with the attachment. The `onClose` sink
  publishes `skip` with `reason: "attachment_closed"` instead of a fabricated
  `resync_required`; the client reaction is identical to congestion (task 74
  Slice 4 contract preserved).
- `terminalService/types.ts` + `client-core/types.ts`: remove the
  `resync_required` shape, add `skip`.
- Attach hardening: if `service.subscribe(fromPosition: H)` throws
  `replay_gap`, release the pin and surface a retryable checkpoint error; the
  renderer's bounded retry requests a fresher pin. Never manufacture a cursor.

### Slice 3 — client position authority (risky)

- `client-core/terminal.ts`: delete `highWatermarks` and the `marks`/`key`
  parameters of `acceptEvent`; delete the `replayBoundary` juggling in
  `openAttachment`; keep `presentation_unavailable`.
- `acceptEvent` becomes: duplicates dropped; `skip` with
  `fromPosition === position` advances to `toPosition`, collapses pending
  acknowledgements and waiters, and is forwarded to listeners; any mismatch
  closes the attachment and emits an explicit stream-failure event — delete
  the `hydrationFailure` swallow.
- Remove the watermark default so an omitted `fromPosition` means 0;
  `terminal.resume` is an alias with no memory.
- `terminalPanel.ts` and `TerminalPanel.tsx` switch from `resync_required` to
  `skip`; `beginTerminalResync` is otherwise unchanged.
  `electron/serverTerminalAuthority.ts` decode updated likewise.
- Risk: after a skip, no further acks are sent for the doomed attachment;
  verify detach's final flush cannot publish a position inside the skipped
  range.

### Slice 4 — adapter shrink

- Delete `highWatermarks`, `maxClientSessionCursors`, `rememberPosition`, and
  the watermark defaulting; `fromPosition` defaults to 0.
- Replace the two swallowed throws with `closeAttachment(id, "error")` so a
  violation reaches the sink's `onClose` → skip + `attachment_closed` →
  client recovery. Nothing in the terminal stream path may die in a
  catch-all again.
- `deliveredPosition` collapses into the subscription's own cursor.

### Slice 5 — deletions and spec updates

Deleted outright:
- the `outboundDelivery.ts` ack-exit branch;
- the `protocol.ts` `outputSuppressed` ack exit;
- `connection.ts` `terminalOutputPositions` and its touchpoints;
- `adapter.ts` watermark memory and both throw sites;
- `client-core/terminal.ts` `highWatermarks`, `replayBoundary`,
  `hydrationFailure` swallow, gap throws;
- `resync_required` from every wire type, decoder, and test;
- `service.ts` `resyncEvent`/`closeForOverflow` **if** no pull-subscription
  consumer remains — verify with a repo-wide search first.

Specs: rewrite the congestion/recovery sections of
`specs/features/terminal-stream-congestion-and-recovery.md` and the
resynchronization acceptance bullets in `specs/features/remote-access.md`
around in-band skip and suppression-until-replacement. Present tense only.

### Slice 6 — acceptance

Both pass **simultaneously** (prior attempts traded one for the other):
- (a) the Slice 0 reproduction; run congest→skip→recover twice on one
  connection to prove no latch survives replacement.
- (b) `outbound-delivery.test.mjs` → "a stalled renderer stays bounded…":
  exactly one bounded congestion and one skip frame, queued bytes/frames
  inside limits, other lanes and control unaffected.

New pinned invariants:
- Skip exactness: `skip.fromPosition` equals the end of the last byte on the
  wire, including the retained-active-delivery case.
- Suppressed lane silence: after one skip, zero further terminal frames for
  that attachment until replacement.
- Hydration contiguity: checkpoint H → replay → live is gapless while the
  producer keeps writing during the attach (the TOCTOU case).
- Recovery under sustained output: repeated skip/recover cycles each complete
  within the retry bound without exhausting checkpoint pins.
- No silent death: an injected server-side ordering violation surfaces as an
  observable attachment failure on the client, not silence.
- E2E `e2e/connection-reconnect-cycles.spec.ts` stays green.

## Findings that changed the plan during implementation

1. **`resync_required` had two unrelated meanings.** Besides the terminal
   event, it is the projection-subscription resync `kind` used by git,
   activity, and agent-status, and the `ClientErrorCode` for subscription
   overflow. Only the terminal event was replaced; the subscription mechanism
   is untouched.
2. **The real reason recovery never converged** is not in the congestion path
   at all. `TerminalService` throttles how fast it feeds the checkpoint
   authority (`CHECKPOINT_PAUSE_BYTES`, 256 KiB) — the same order as the
   lane's unconfirmed-bytes bound. Under sustained output a prepared
   checkpoint's head therefore sits far behind the live head, and hydration
   replays that difference *through the presentation lane*, which re-congests
   it immediately. Every recovery attempt re-armed the failure. This is now
   bounded by `MAX_CHECKPOINT_CATCHUP_BYTES` (128 KiB, deliberately below the
   lane bound): past it the stream starts at the live head and the intervening
   range is an ordered skip.
3. **Retained replay is bounded, so a fresh attach can legitimately begin
   after the cursor it asked for.** That is a server-known discontinuity, so
   the adapter states it as a skip instead of treating it as a fault.
4. **Skip is monotonic rather than strictly contiguous.** An
   `attachment_closed` skip is journalled and travels the state lane, so it
   can overtake terminal-lane output; requiring `fromPosition === position`
   would turn benign ordering into a spurious fault. Strict contiguity is
   enforced on *output*, which is where corruption actually shows up.
5. **`closeForOverflow` has no external consumers** (open question 4): it is
   used only by the pull-subscription enqueue path, so it was kept and
   converted to emit a skip.

## Follow-up: the hydration recovery loop (post-deploy)

Deploying the change above surfaced a defect it introduced. A fresh
presentation whose checkpoint trailed the live head was delivered with a skip
describing the difference, and the panel treats a skip as "re-hydrate". That
skip arrives inside the attach's own initial events, so hydrating triggered
another hydration, whose checkpoint trailed by the same amount. The terminal
painted once and never again while its connection stayed busy and healthy -
inbound frames and bytes climbing the whole time, which is exactly what made it
look like a dead stream rather than a loop.

Two things were wrong, and both are fixed:

1. **A gap established during hydration was indistinguishable from falling
   behind.** `TerminalSkipReason` now has a third value, `hydration`, and
   `isRecoverableSkip` (client-core, shared with the panel) is the single place
   that decides what re-hydrates. Re-attaching cannot repair a boundary that
   re-attaching reproduces.
2. **The checkpoint was routinely stale.** Output reaches the checkpoint
   authority through a bounded drain, and only `readPresentation` waited for
   it; `prepare` did not. Every fresh presentation therefore pinned a screen
   that was behind by whatever was still queued - about 280 KB under sustained
   output. `TerminalService.settlePresentation` now lets that drain catch up
   before a checkpoint is pinned, so the common case hydrates with no gap at
   all. It is bounded by a deadline: a terminal that never falls silent must
   not be able to stall an attach, and when the deadline is reached the
   existing bounded skip still applies.

The catch-up skip is now a genuine last resort rather than the routine path.

## Open questions and risks

1. **Permanent overload behaviour.** A producer that outruns the client
   forever yields a visible skip/recover cycle at the retry cadence. That is
   the intended convergence behaviour, but the cadence and checkpoint pin
   churn under a maximal-rate producer on a slow link remain unproven by load
   test.
2. **Checkpoint lag is now bounded but not eliminated.** `MAX_CHECKPOINT_CATCHUP_BYTES`
   is a fixed constant rather than a value derived from the connection's
   configured lane limits. A host that lowers `maxTerminalUnconfirmedBytes`
   below 128 KiB could still hydrate into congestion.
3. **Duplicate-subscription consumers.** Deleting
   `connection.terminalOutputPositions` assumes nothing relies on duplicated
   terminal events across overlapping subscriptions; the lane's own dedupe
   covers the case the map existed for, and the overlapping-subscription test
   still passes.

## Definition of done

- [x] Reproduction test passes with the new design
      (`terminal-congestion-recovery.test.mjs`).
- [x] The stalled-renderer test passes with its invariants unchanged: exactly
      one bounded congestion, one skip frame, queued bytes/frames in limits,
      other lanes unaffected. Both acceptance tests pass simultaneously.
- [x] `resync_required` no longer exists as a terminal event; `skip` is the
      only discontinuity representation and is in band.
- [x] Exactly three position trackers remain (service, lane, client mirror).
      `adapter.highWatermarks`, the client `highWatermarks`, and
      `connection.terminalOutputPositions` are deleted.
- [x] No terminal-stream code path swallows a positioning error: the adapter
      closes the attachment instead of throwing into a catch-all, the
      subscription reports listener faults, and the client's
      `hydrationFailure` swallow is gone.
- [x] Ack-based exits for `resyncPending` and `outputSuppressed` are gone;
      suppression ends at attachment replacement and only there.
- [x] Both feature specs describe only the new contract.
