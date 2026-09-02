# Design

## Context

In the vendored artifact, built from `werift@0.24.1`, the SCTP association's send path is gated on the peer's advertised receive window: the available peer window is the advertised window less the flight size, and the transmit loop admits work only while the outbound queue is non-empty, the flight size is below the congestion window, and that available peer window is above zero. The advertised window is assigned only from a received SACK, and a SACK arrives only in response to DATA. The T3 retransmission timer is cancelled whenever the sent queue drains.

So in the state where the advertised window is zero and the flight size is zero:

- the transmit loop admits nothing, because the available peer window is zero;
- no DATA is sent, so no SACK is returned;
- no SACK means the advertised window never updates;
- no timer is armed, so nothing re-enters the transmit loop.

Outbound delivery is then permanently stuck with the peer connection still connected and every lane still open. RFC 4960 §6.1 rule A requires a zero-window probe precisely to break this: the sender must periodically transmit one chunk past a zero window to elicit a SACK carrying the reopened window. Werift implements no such probe. A receiver reaches a zero window when its application stops draining — a backgrounded phone tab, or a renderer briefly outpaced by a large PTY burst.

### Why this was separate from the connection-lifecycle change

The preceding connection-lifecycle change fixed the reported frozen-checkpoint loop, whose cause was connection-scoped teardown keyed on a shared device id. That is a different defect and it is fixed. This one is a latent transport hazard found while tracing it: not proven to have fired in production, but reachable, and indistinguishable from the symptom users reported. That change's heartbeat now detects the deadlock within 60 seconds and replaces the generation, so a deadlocked association is recovered rather than permanent — this change removes the cause.

The selected runtime is governed supply-chain material. Changing its patch set touches every layer of that governance, which is why this is its own change rather than a slice of the connection fix: the patch directory, the candidate build script's apply-and-attest step, the selection record's patch list, the server's selection validation, and the selection, release-contract, and offline-rebuild proofs all pinned a single-patch shape.

## Goals / Non-Goals

Goals:

- The transport recovers on its own when a peer's window reopens, without a reconnect and without waiting for the heartbeat to replace the generation.
- The runtime's patch set becomes an ordered, hash-pinned, attested list rather than one hard-coded patch.
- The determinism proof runs somewhere it cannot silently stop running.

Non-Goals:

- Changing upstream Werift's behaviour beyond the two defects, or moving off the selected runtime.
- Altering the application protocol, the lane model, or the heartbeat, all of which are unchanged.
- Replacing the heartbeat-driven generation replacement, which stays as the outer safety net.

## Decisions

**Patch the vendored runtime rather than work around it above the transport.** The deadlock is in the association's transmit loop; nothing above SCTP can observe a zero window or arm the timer that would re-enter the loop. Working around it by periodically writing filler on an application lane was rejected: it would put transport-recovery semantics into the application protocol, waste bandwidth on every healthy connection, and still not arm the retransmission timer.

**Write the patch against the pinned upstream commit.** The patch targets `werift@0.24.1` at the pinned `gitHead`, so it applies to the exact source the deterministic build mirrors. In the SCTP association: when the outbound queue is non-empty, the flight size is zero, and the available peer window is zero, send exactly one chunk and start T3 so a SACK is elicited; do not grow the congestion window from a probe acknowledgement; keep the probe bounded by the existing retransmission backoff.

**Fix the flush re-entry in the same patch.** The data-channel flush shifts from a queue shared by every channel and is called from both the send path and the association's own callbacks, so two concurrent flush loops can interleave sends on one stream. It is in the same file and the same governed rebuild, so splitting it into a separate patch would cost a second full attestation cycle for no isolation benefit.

**Generalize governance to an ordered patch list.** The build script applies and attests patches in order; the selection record carries a `patches[]` array; selection validation asserts the ordered list, each path, hash, and purpose, rather than a count of one. Ordering is attested because patch application is order-dependent and two orderings of the same set are not the same artifact. A single combined patch was rejected: it would keep the count assertion working but lose the ability to describe and review each defect separately.

**Prove the deadlock against the artifact the server actually loads, not against upstream source.** The verification drives the association directly: the unpatched runtime sends nothing and arms no timer from a zero window with an empty flight, while the rebuilt artifact sends exactly one probe and arms T3.

**Run the determinism proof where the runtime is already staged.** The proof belongs in the release workflow, where the artifact is staged and the rebuild cost is already being paid, and the whole selection suite is wired into the release-evidence script so a proof that stops being executed fails the release rather than passing silently.

### Security and architectural boundaries crossed

This change alters governed supply-chain material: the WebRTC runtime the server loads to terminate remote connections. Every layer that exists to make that artifact reviewable — pinned upstream source and commit, hash-pinned patches, attested provenance, SBOM and notices, and two independent offline rebuilds producing identical hashes — is preserved and extended rather than relaxed. The server's load-time selection validation stays a refusal, not a warning.

## Risks / Trade-offs

- Patching a transport runtime risks introducing a worse defect than the one fixed → the probe is confined to a state in which the runtime currently does nothing at all, does not grow the congestion window, and reuses the existing retransmission backoff.
- Loosening the exactly-one-patch assertion could weaken the governance it was standing in for → the assertion is replaced by an ordered list where each entry's path, hash, and purpose is pinned and attested, which is strictly more specific than a count.
- The zero-window state is not proven to have fired in production, so the change is fixing a reachable hazard rather than a confirmed incident → the outer heartbeat safety net remains, so the change is a cause removal, not the only mitigation.
- The determinism proof had rotted once already, unwired from any workflow or script and asserting CI steps that no longer existed for a CI system this repository no longer runs → it is now executed by the release workflow and covered by the release-evidence script, so a proof that stops running fails a release.

## Outcome

Both defects are fixed in a new SCTP patch, applied by the governed build after the TURN-refresh patch and pinned by hash in the selection record, the build script's provenance, the server's runtime selection validation, and the release-readiness check — all of which now take an ordered patch list instead of asserting exactly one patch.

Verified against the artifact the server actually loads: the unpatched runtime sends nothing and arms no timer from a zero window with an empty flight, while the rebuilt artifact sends exactly one probe and arms T3. A recovery test pins both that and the flush serialization, and was confirmed to fail against the previous artifact. Two independent rebuilds produced identical archive and file hashes.

The determinism proof now runs in the release workflow, and the whole selection suite is wired into the release-evidence script so it cannot silently rot again.

## Migration Plan

The patched artifact replaces the selected runtime in one release. The selection record, provenance, SBOM, and notices are refreshed together, so an artifact and its attestation never disagree. Rollback is a rollback of the selection record to the previous pinned artifact and hashes; nothing above the transport depends on the probe existing, so the previous artifact remains loadable under the generalized validation as a one-entry patch list.

## Open Questions

- The two-peer test that drives a receiver's advertised window to zero end to end, and the two-channel flush interleaving test, are the acceptance conditions this change states; whether the direct association-level verification already performed is accepted as satisfying them is not settled by the source record.
