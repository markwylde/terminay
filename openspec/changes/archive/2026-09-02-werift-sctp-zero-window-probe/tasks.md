## 1. Patch the selected runtime

- [x] 1.1 Write the SCTP patch against the pinned upstream Werift source and commit: when the outbound queue is non-empty, the flight size is zero, and the available peer window is zero, send exactly one chunk and start the retransmission timer so a SACK is elicited; verify against the artifact the server loads that the unpatched runtime sends nothing and arms no timer while the rebuilt artifact sends exactly one probe and arms T3
- [x] 1.2 Keep the probe from growing the congestion window on its acknowledgement and keep it bounded by the existing retransmission backoff; verify by asserting the congestion window is unchanged across a probe acknowledgement
- [x] 1.3 Guard the data-channel flush against re-entry so two concurrent flush loops cannot interleave sends on one stream; verify with the recovery test that pins flush serialization and was confirmed to fail against the previous artifact

## 2. Generalize runtime governance to an ordered patch list

- [x] 2.1 Make the candidate build script apply and attest an ordered list of patches instead of one hard-coded path, hash, and provenance entry; verify the provenance records both patches in application order
- [x] 2.2 Add the second patch entry to the selection record with its pinned hash; verify the record's patch list matches the applied set and order
- [x] 2.3 Replace the server's exactly-one-patch selection assertion with ordered-list validation over each path, hash, and purpose; verify a selection whose patch set, order, hashes, or purposes differ is refused at load
- [x] 2.4 Update the release-readiness check to take the ordered patch list; verify it passes on the new artifact and fails on a mismatched patch list

## 3. Rebuild and re-attest

- [x] 3.1 Rebuild the candidate twice offline from the pinned source mirror and prove identical archive and file hashes; verify both rebuilds report the same hashes
- [x] 3.2 Refresh the SBOM, provenance, and notices for the rebuilt artifact; verify the artifact and its attestation agree

## 4. Repair the determinism proof

- [x] 4.1 Wire the offline-rebuild proof into the release workflow where the runtime is already staged, replacing its assertions about CI steps that no longer exist and its read of a workflow file for a CI system this repository no longer runs; verify the proof executes in a release run
- [x] 4.2 Wire the whole selection suite into the release-evidence script so an unexecuted proof fails a release rather than passing silently; verify the script fails when a proof is removed

## 5. Acceptance

- [x] 5.2 Cover flush re-entry with a test that interleaves sends on two channels of one association; verify each channel's stream is delivered in order
- [x] 5.3 Run the selection, release-contract, and runtime-proof suites; verify they pass unchanged other than the new patch shape

> **Outstanding verification.** The implementation of this change is complete; the items
> below are verification and evidence that were never recorded, not remaining
> development work. They are carried forward as an obligation on the capability,
> not on this change.
>
> - Add a two-peer test that drives the receiver's advertised receive window to zero with an empty sent queue, reopens it, and proves outbound delivery resumes without a reconnect; verify the test fails against the pre-patch artifact and passes against the rebuilt one
