## 1. Pin the failure

- [x] 1.1 Extend `packages/server-core/test/terminal-congestion-recovery.test.mjs` to attach, stream, stop acknowledging, burst ~400 KiB into congestion, then perform the documented recovery through a real terminal client with the checkpoint query wired, keep producing during hydration, and verify by asserting the rendered stream reaches the producer head and stays live — red on main before the change
- [x] 1.2 Assert both silent-death mechanisms directly — a post-hydration client gap and a swallowed adapter contiguity throw — and verify each becomes observable rather than discarded

## 2. Lane skip semantics in the delivery pump

- [x] 2.1 Add per-lane `sentPosition`, carry each terminal delivery's `nextPosition`, and advance `sentPosition` on delivery completion; verify by the skip-exactness invariant including the retained in-flight delivery case
- [x] 2.2 Make lane congestion discard the backlog and enqueue exactly one skip frame from the retained delivery's end position or `sentPosition` to the lane head, and set the lane suppressed; verify with the stalled-renderer test asserting exactly one congestion and one skip frame
- [x] 2.3 Delete the acknowledgement-based suppression exit so suppression clears only on attachment release; verify by asserting an acknowledgement during suppression lifts nothing
- [x] 2.4 Implement lane admission rules — duplicate dropped, discontinuous congests with a skip, suppressed resolves and drops; verify with admission unit tests for each branch

## 3. Protocol and wire event

- [x] 3.1 Replace the `resync_required` terminal payload with the `skip` payload at the pump boundary and delete the connection-level `terminalOutputPositions` map and its touchpoints; verify the overlapping-subscription test still passes
- [x] 3.2 Delete the protocol layer's acknowledgement-based output-suppression exit and publish an `attachment_closed` skip from the close sink instead of a fabricated resync; verify the client reaction is identical to the congestion path
- [x] 3.3 Remove the `resync_required` shape and add `skip` to the server and client wire types; verify by a repo-wide search finding no terminal-event use of the old name while the unrelated subscription resync kind and error code remain
- [x] 3.4 Harden attach so a replay gap releases the checkpoint pin and surfaces a retryable error instead of manufacturing a cursor; verify the renderer's bounded retry requests a fresher pin

## 4. Client position authority

- [x] 4.1 Delete the client high-watermark map, the replay-boundary juggling, and the watermark default so an omitted `fromPosition` means 0 and resume carries no memory; verify by asserting a resume with no argument starts at 0
- [x] 4.2 Rewrite event acceptance so duplicates drop, a skip advances position and collapses pending acknowledgements and waiters, and an output mismatch closes the attachment with an observable stream-failure event; verify the `hydrationFailure` swallow and both throw sites are gone
- [x] 4.3 Switch the terminal panel, the workspace terminal component, and the Desktop terminal-authority event decode to `skip`; verify the resync-to-fresh-checkpoint loop is otherwise unchanged
- [x] 4.4 Verify detach's final flush cannot publish a position inside a skipped range

## 5. Adapter shrink

- [x] 5.1 Delete the adapter's watermark memory, cursor cap, and remembered-position path so `fromPosition` defaults to 0; verify no resume path can supply a cursor of its own
- [x] 5.2 Replace both swallowed throws with an explicit attachment close so a violation reaches the close sink as an `attachment_closed` skip; verify with an injected ordering fault surfacing on the client
- [x] 5.3 Collapse `deliveredPosition` into the subscription's own cursor; verify the subscription reports listener faults rather than discarding them

## 6. Checkpoint catch-up and the hydration loop

- [x] 6.1 Bound checkpoint catch-up below the lane's unconfirmed-bytes limit so hydration cannot replay straight back into congestion; verify recovery converges under sustained output
- [x] 6.2 Add the `hydration` skip reason and a single shared predicate deciding what re-hydrates; verify a gap established during attach paints once and does not re-arm hydration
- [x] 6.3 Settle the checkpoint drain within a bounded deadline before pinning a fresh presentation; verify the common case hydrates with no gap and a never-silent terminal cannot stall an attach

## 7. Deletions and spec updates

- [x] 7.1 Delete the superseded acknowledgement exits, the connection position map, the adapter watermark memory and throw sites, the client watermarks and swallow, and `resync_required` from every wire type, decoder, and test; verify with a repo-wide search
- [x] 7.2 Confirm the overflow-close path's only consumer is the pull-subscription enqueue path and convert it to emit a skip; verify with a repo-wide search for external consumers
- [x] 7.3 Rewrite the congestion and recovery contract and the remote-access resumption contract around in-band skip and suppression-until-replacement, in present tense

## 8. Acceptance

- [x] 8.1 Run the reproduction and the stalled-renderer bound simultaneously, and run congest, skip, and recover twice on one connection; verify no latch survives attachment replacement
- [x] 8.2 Pin the new invariants — skip exactness, suppressed-lane silence, hydration contiguity, repeated recovery within the retry bound without exhausting checkpoint pins, and no silent death under an injected ordering violation
- [x] 8.3 Verify `e2e/connection-reconnect-cycles.spec.ts` stays green
- [x] 8.4 Load-test a maximal-rate producer on a slow link and record the skip and recover cadence and checkpoint pin churn under permanent overload; verify the cycle converges at the retry cadence rather than exhausting pins
- [x] 8.5 Decide whether the checkpoint catch-up bound should be derived from the connection's configured lane limits; verify by proving a host that lowers the unconfirmed-bytes limit below the constant cannot hydrate into congestion
