## Why

A remote workspace could stop receiving anything from its server while the connection, ICE, and every data channel still reported healthy. If a peer's SCTP receive window reaches zero with nothing in flight — a backgrounded phone tab, or a renderer briefly outpaced by a large PTY burst — the selected Werift runtime deadlocks outbound delivery permanently, because it implements no zero-window probe and nothing re-enters its transmit loop. The symptom is indistinguishable from the frozen-terminal reports users made.

## What Changes

- Add a zero-window probe to the selected Werift runtime's SCTP association: when the outbound queue is non-empty, the flight size is zero, and the peer's advertised window is zero, send exactly one chunk and arm the retransmission timer so a SACK carrying the reopened window is elicited. The probe does not grow the congestion window from its acknowledgement and stays bounded by the existing retransmission backoff.
- Guard the data-channel flush against re-entry. It shifts from a queue shared by every channel and is called from both the send path and the association's own callbacks, so two concurrent flush loops could interleave sends on one stream.
- **BREAKING** for the runtime governance shape: the build script, the selection record, the server's selection validation, and the release-readiness check take an ordered list of patches instead of asserting exactly one patch. Every patch stays hash-pinned and attested in provenance.
- Rebuild the candidate artifact deterministically and prove two independent offline rebuilds produce identical archive and file hashes, then refresh the SBOM, provenance, and notices.
- Repair the determinism proof itself, which had rotted: it was wired to no workflow and no npm script, and its test asserted CI steps that no longer existed and read a workflow file for a CI system this repository no longer uses. It now runs in the release workflow, where the runtime is already staged, and the whole selection suite is wired into the release-evidence script so it cannot silently rot again.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `remote-access`: the WebRTC transport recovers from a peer zero receive window without a reconnect, concurrent data-channel flushes cannot interleave on one stream, and the server validates its selected runtime against an ordered hash-pinned patch list at load.

## Impact

- The vendored WebRTC runtime artifact and its selection record.
- A new SCTP patch under the build's patch directory, applied after the existing TURN-refresh patch.
- The candidate build script, which today hard-codes a single patch path, hash, and provenance entry.
- The server's secure Werift runtime selection validation, which today asserts exactly one patch and pins one exact path, hash, and purpose.
- The selection, release-contract, and offline-rebuild proofs, which pin the same single-patch shape.
- The release workflow and the release-evidence npm script.
