# 75 — Werift SCTP zero-window probe — DONE

## Goal

The selected Secure-Werift runtime recovers when a peer's receive window
reopens. Today a zero window with nothing in flight deadlocks outbound
delivery permanently while ICE and every data channel still report healthy.

## Evidence

In the vendored artifact (`build/webrtc-runtime/artifact/lib/index.mjs`, built
from `werift@0.24.1`), the SCTP association's send path is gated on the peer's
advertised receive window:

```js
get peerRwnd() { return Math.max(0, this.peerAdvertisedRwnd - this.flightSize) }
...
while (this.outboundQueue.length > 0 && this.flightSize < cwnd && this.peerRwnd > 0) {
```

`peerAdvertisedRwnd` is only ever assigned from a received SACK
(`this.peerAdvertisedRwnd = chunk.advertisedRwnd` in `receiveSackChunk`), and a
SACK only arrives in response to DATA. The T3 retransmission timer is cancelled
whenever the sent queue drains (`if (this.sentQueue.length === 0) this.timer3Cancel()`).

So in the state `peerAdvertisedRwnd === 0` with `flightSize === 0`:

- the transmit loop admits nothing, because `peerRwnd` is `0`;
- no DATA is sent, so no SACK is returned;
- no SACK means `peerAdvertisedRwnd` never updates;
- no timer is armed, so nothing re-enters `transmit()`.

Outbound delivery is then permanently stuck with the peer connection still
`connected` and every lane still `open`. RFC 4960 §6.1 rule A requires a
zero-window probe precisely to break this: the sender must periodically
transmit one chunk past a zero window to elicit a SACK carrying the reopened
window. Werift implements no such probe.

A receiver reaches a zero window when its application stops draining — a
backgrounded phone tab, or a renderer briefly outpaced by a large PTY burst.

## Outcome

Both defects are fixed in
`scripts/patches/werift-0.24.1-sctp-zero-window-probe.patch`, applied by the
governed build after the TURN-refresh patch and pinned by hash in
`selection.json`, the build script's provenance, `secureWeriftRuntime.ts`, and
`release-readiness.mjs` — all of which now take an ordered patch list instead
of asserting exactly one patch.

Verified against the artifact the server actually loads: the unpatched runtime
sends nothing and arms no timer from a zero window with an empty flight, while
the rebuilt artifact sends exactly one probe and arms T3.
`scripts/secure-werift-sctp-recovery.test.mjs` pins both that and the flush
serialization, and was confirmed to fail against the previous artifact. Two
independent rebuilds produced identical archive and file hashes.

The determinism proof itself had rotted: `prove-secure-werift-offline-rebuild.mjs`
was wired to no workflow and no npm script, and its test asserted CI steps that
no longer existed (it also read `.github/workflows/ci.yml` while this repository
runs Gitea Actions). The proof now runs in the release workflow, where the
runtime is already staged and the cost belongs, and the whole selection suite
is wired into `test:release-evidence` so it cannot silently rot again.

## Why this was separate from task 74

Task 74 fixed the reported frozen-checkpoint loop, whose cause was
connection-scoped teardown keyed on a shared device id. That is a different
defect, and it is fixed. This one is a latent transport hazard found while
tracing it: not proven to have fired in production, but reachable, and
indistinguishable from the symptom users reported. Task 74's heartbeat now
detects it within 60 seconds and replaces the generation, so a deadlocked
association is recovered rather than permanent — this task removes the cause.

## Scope

The selected runtime is governed supply-chain material. Changing its patch set
touches every layer of that governance, which is why this is its own task
rather than a slice of the connection fix:

- `scripts/patches/werift-0.24.1-zero-window-probe.patch` (new).
- `scripts/build-secure-werift-candidate.mjs`: apply and attest both patches;
  today it hard-codes a single patch path, hash, and provenance entry.
- `build/webrtc-runtime/selection.json`: a second `patches[]` entry.
- `apps/terminay-server/src/remote/secureWeriftRuntime.ts`: `validateSelection`
  asserts `patches.length !== 1` and pins one exact path/hash/purpose.
- The selection, release-contract, and offline-rebuild proofs pin the same
  single-patch shape.

## Implementation

1. Write the patch against `werift@0.24.1` at the pinned `gitHead`
   `243fd7e24c39fbe03fb855928daddd793fc8d4fa`. In the SCTP association:
   - when `outboundQueue` is non-empty, `flightSize === 0`, and `peerRwnd === 0`,
     send exactly one chunk and start T3, so a SACK is elicited;
   - do not grow `cwnd` from a probe acknowledgement;
   - keep the probe bounded by the existing RTO backoff.
2. While in that file, guard `dataChannelFlush` against re-entry: it shifts
   from a queue shared by every channel and is called from both
   `datachannelSend` and the association's own callbacks, so two concurrent
   flush loops can interleave sends on one stream.
3. Generalize the build script and `validateSelection` to an ordered patch
   list, keeping every patch hash-pinned and attested.
4. Rebuild the candidate twice from the source mirror and prove identical file
   hashes (`scripts/prove-secure-werift-offline-rebuild.mjs`), then refresh the
   SBOM, provenance, and notices.

## Definition of done

- [ ] A two-peer test drives the receiver's advertised window to zero with an
      empty sent queue, reopens it, and proves outbound delivery resumes
      without a reconnect. This test fails against the current artifact.
- [ ] `dataChannelFlush` re-entry is covered by a test that interleaves sends
      on two channels of one association.
- [ ] Both patches are hash-pinned in `selection.json`, applied by the build
      script, and attested in provenance.
- [ ] Two independent offline rebuilds produce identical hashes.
- [ ] Selection, release-contract, and runtime-proof suites pass unchanged
      other than the new patch shape.
