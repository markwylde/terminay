## Why

Terminal input must remain ordered and safe when a device reconnects, a terminal changes attachment, or delivery stalls. Review probes found gaps between those boundaries, while the detached holder still pays retention costs that grow with its retained chunk count.

## What Changes

- Preserve successful attachment handoff and definitive-refusal retries; discard uncertain successors and visibly resume input only once a replacement presentation is hydrated.
- Route production macros, dictation, automation, and app-window messages through the same bounded server input queue as interactive input, keeping their existing scoped authorization. This is an admission/attribution boundary, not end-to-end PTY backpressure.
- Report renderer input overflow visibly and bound retained large-paste data, preserving Unicode-safe chunking and Stop behavior.
- Deduplicate concurrent commands within one connection and correlate repeated results to their own requests.
- Keep heartbeat and cancellation serviceable when feature-handler capacity is full; retain excess feature work in a byte- and frame-bounded FIFO rather than blocking reads; close at the final safety ceiling.
- Decode recording output across UTF-8 callback boundaries with recording-scoped state.
- Replace holder array eviction with bounded queue storage, preserving retained bytes, output positions, protocol bytes, and holder lifetime; eliminate repeated canonical-JSON validation traversals without weakening public validation.
- Reconcile obsolete remembered-cursor language with rendered-position and fresh-checkpoint recovery.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `terminal-workspace`: bounded, visible input admission and one ordered queue for every admitted source; actual rendered cursors on reconnect.
- `terminal-stream-congestion-and-recovery`: input safety applies across attachment generations while successful recovery retains ordered pending input.
- `server-runtime-and-protocol`: concurrent command idempotency and feature admission that preserves liveness and cancellation.
- `recording`: UTF-8 continuity across terminal-output callbacks and explicit decoder lifetime.

## Impact

Shared renderer input queue; client comments; server composition, terminal input sources, automation, standalone and embedded host adapters; dispatcher and connection admission; recording service; holder retention; protocol JSON serializer; focused tests and benchmarks. No public wire-format change, dependency addition, renderer privilege, or change to output acknowledgements, checkpoint fencing, presentation ownership, or fair output delivery.

Presentation preservation after holder-ring wrap and server replacement needs a separate architectural design: an arbitrary byte suffix cannot reconstruct terminal state. This change does not claim to solve that problem, alter frozen holder protocols, or introduce a second terminal emulator into the holder. A single combined attention RPC and recording durability changes remain outside this implementation. Existing activity and agent RPCs may be coalesced independently during bursts, without using stale projection snapshots or changing passive acknowledgement semantics.

Final review refinements distinguish unsent connection loss, normalize cancellation, reject invalid holder bounds before side effects, and keep input notices consistent with readiness.
