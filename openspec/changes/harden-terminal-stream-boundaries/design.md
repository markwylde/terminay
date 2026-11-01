## Context

The review at `c9bf02a8` found reproducible boundary gaps while existing terminal streaming tests passed. The reviewed architecture remains: server-owned PTYs, detached holder generations, scoped input authority, one presentation controller, parser-safe checkpoints, ordered output lanes, cumulative display acknowledgements, and recovery independent of PTY silence.

The ADR inventory and supersession graph were reviewed. In-force constraints relevant here include ADR-0011 (authorization), ADR-0041 (sleep-aware liveness), ADR-0043 (retired terminal identities), ADR-0044 (output-path cost), ADR-0048 (connection lifetime), ADR-0058 (live terminal facts), and ADR-0086 (holder topology and authenticated internal transport, carrying the earlier topology decisions forward). No accepted ADR is edited.

## Goals / Non-Goals

**Goals:** Close demonstrated input, command, admission, and recording gaps; reduce measured holder-retention cost and redundant serializer traversal; retain existing wire and synchronization contracts.

**Non-Goals:** New holder protocol or checkpoint authority; automatic retries after unknown command outcomes; attention acknowledgement semantics; recording disk durability changes; changing output acknowledgement cadence, congestion policy, or workspace persistence.

## Decisions

### Unknown input outcomes end input continuity across generations

Confirmed writes and definitive pre-PTY refusals retain today's ordered handoff behavior. An unknown outcome on a replaced attachment discards successors, cancels pending paste, and raises an input interruption notice. Input resumes only when the current replacement is a hydrated controller. It does not permanently close the mounted panel or fail an otherwise healthy output connection. An unknown outcome on the current attachment retains its existing transport-failure recovery. A replacement attachment proves nothing about whether a prior write reached the shell.

This deliberately revisits the unknown-outcome tradeoff in the completed but unarchived `terminal-input-survives-attachment-handoff` proposal. Its successful-handoff and definitive-refusal guarantees remain. The current `terminal-stream-congestion-and-recovery` safety requirement controls the uncertain case; the delta makes its cross-generation scope explicit.

Alternative: continue unsent successors after dropping only the ambiguous chunk. That can submit a command with a missing prefix and is rejected. Retrying the ambiguous chunk risks duplicate shell input and is also rejected.

### One composed input-source adapter owns production admission

Create or accept one `TerminalInputSourceAdapter` when composing an authority; expose it to trusted host services and supply it to terminal protocol and automation. Standalone and embedded macro, dictation, and window-message paths submit through that same instance. Keep existing target resolution and scoped authorization. Noninteractive sources do not acquire presentation leases. Low-level `TerminalService.input` remains the adapter's PTY boundary and a primitive for isolated service tests.

Alternative: add independent queues to each feature. This cannot order competing sources and multiplies backpressure budgets. Moving asynchronous feature authorization into the holder would cross the privilege boundary and is unnecessary.

### Overflow fails visibly and retained paste bytes have their own bound

Retain the 64 KiB ordinary-input bound and add a finite aggregate retained-paste budget. Refuse over-capacity input through a dedicated non-modal input notice, pause input and discard unsent successors until the user acknowledges the interruption. Do not fail the output connection. Charge a large paste for its retained string until completion/cancellation, independently of the next 16 KiB transport chunk. Release accounting on all teardown paths. Preserve the Stop action and Unicode-safe chunk slicing.

Alternative: keep sending later keys after silently refusing one item. That creates command gaps. Raising all limits or retaining repeated unbounded clipboard strings only delays the failure.

### Track in-flight commands without changing reconnect semantics

Keep completed outcomes and in-flight completion promises within each bounded connection ledger. Reserve an identity synchronously before invoking a handler; concurrent duplicates share the original outcome, and every response uses its own correlation ID. Command identity includes a digest of operation, canonical payload, expected revision and body, rejecting conflicting reuse. A duplicate wait can be cancelled without cancelling the original request. Only the actual handler execution applies connection delivery side effects. Bound direct-dispatch in-flight admissions as well as framed feature slots. Command IDs continue to identify one logical immutable command; they do not authorize automatic retries across connections.

Alternative: serialize all commands for a connection. That imposes head-of-line blocking on unrelated terminals. Persisting outcomes across connections is a different delivery guarantee and is excluded.

### Admit control independently of feature slots

Bound in-flight feature requests at the existing 64 slots. Continue reading frames so heartbeat and cancellation reach their handlers and transport end aborts pending work. Retain excess feature frames in a FIFO bounded by 16 MiB (or the configured connection byte budget) and 256 frames, preserving arrival deadlines. Cancellation can remove a queued request before execution. A FIFO safety-ceiling breach closes the connection with a content-free resource diagnostic. Keep the outbound pump's bounded reliable-control queue, protocol validation, and per-turn yielding.

The shared SDK caps outstanding feature requests at 128, below the server's 64 active plus 256 pending slots, and caps their captured encoded bytes to the negotiated queue budget. Further calls wait in a FIFO bounded by 4,096 frames and the byte budget. Heartbeat and cancellation bypass it. Queue time is deducted from deadlines; abort/close removes unsent requests, which report a definitive pre-send failure rather than an unknown command outcome. Normal under-capacity calls acquire synchronously. This prevents ordinary desktop bursts from hitting the server's final safety ceiling.

Alternative: remove every bound. That creates unbounded handler and memory pressure. An unbounded inbound feature queue defeats explicit admission. Rejecting an ordinary terminal-input burst with a resource error would instead fail that panel and is avoided.

### Scope streaming recording decoders to active captures

Let recording services accept output bytes and retain a streaming UTF-8 decoder only for active captures. Flush incomplete bytes on finalization before writing final metadata and release state at stop/failure. A later recording gets a new decoder. Keep string input supported for existing callers; canonical composition and the embedded output observer pass raw bytes. Recording disabled remains a cheap no-op.

### Change storage and traversal, not wire semantics

Use the existing bounded chunk queue in the holder with a retention mode preserving the holder's existing whole-chunk, keep-the-newest-chunk eviction rule, including configurations smaller than a single output chunk. Keep positions, ring byte bounds, replay order, and tail writing unchanged. Existing running holders are not replaced; new builds use the new storage in their own generations.

Canonical JSON validates the full value at each public boundary once, then a private recursive serializer handles that validated tree. Preserve canonical ordering, finite-number/depth checks, duplicate-key rejection, fatal UTF-8 decode, envelope validation, and exact wire bytes. Do not skip external validation or change the frame format.

## Risks / Trade-offs

- [Unknown input failures become visible more often during replacement] → This is intentional fail-closed behavior; confirm successful congestion recovery still preserves every key and a definitive refusal retries once.
- [Production features accidentally create different adapters] → Composition tests mix actual feature sources behind a held PTY write, and host tests assert use of the composed adapter.
- [Paste cancellation or ownership change leaks accounting] → Test repeated large pastes, cancellation while a chunk is in flight, handoff, close, and read-only transitions.
- [Admission rejects a legitimate large burst] → Queue admitted-frame bursts within finite byte/frame bounds, keep unrelated control responsive, and test terminal hydration under ordinary fanout.
- [Deduplicated waits outlive cancellation or consume unbounded state] → Bound pending identities, isolate duplicate cancellation, and retain connection abort/deadline behavior.
- [Decoder state crosses recording lifetimes] → Own it in the active recording and test every split of multibyte characters plus start/stop/failure.
- [Microbenchmark improvement is mistaken for application latency improvement] → Report isolated storage/codec measurements separately and run a native terminal workload before claiming end-to-end benefit.

## Migration Plan

No persisted-state or wire-format migration. Ship in a normal build; existing held generations continue with their own code and lifetime. Rollback restores previous implementation without rewriting session data. Keep architectural restart-presentation work separate and proposal-only until its surviving authority and bounded-tail design are proven.

## Open Questions

None blocking this bounded implementation. Restart screen preservation requires a separate proposal and a full-state oracle spanning server replacement, ring wrap, resizes, and incremental terminal output. Claude's independent read-only review confirmed the bounded fixes and supplied these qualifications: admission is not PTY-consumption backpressure; control must bypass a bounded pending FIFO; conflicting command reuse must not advance delivery credit; recording can avoid decoding unrecorded output. Its full response is retained with the review evidence.

### Attention bursts retain one pending acknowledgement per kind

Coalesce interactive activity and agent acknowledgements independently per session: one in flight and at most one trailing request. Never skip against a projection snapshot, merge passive acknowledgements, or rely on agent acknowledgement succeeding when the agent service is inactive. A quiet key may still generate both acknowledgements; measure burst request counts and do not promise one RPC per key universally.
