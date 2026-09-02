# Task 20 artifact contract evidence

This evidence is limited to deterministic, platform-neutral local checks. It
does not claim a signed, notarized, published, or native release artifact.

`scripts/task20-release-artifact.mjs` now carries named entrypoints in the
file-backed artifact manifest. Each entrypoint references one manifest file
and repeats its exact byte size and SHA-256 digest. Reading an artifact
re-hashes every payload file, rejects missing or unexpected files, and rejects
entrypoint metadata that does not match the referenced file.

The focused test covers both a standalone-server-shaped payload and a
Desktop-shaped payload with separate main, preload, and embedded-server
entrypoints. It asserts fixed fixture hashes and detects entrypoint tampering.

Artifact IDs are immutable at the staging boundary. The writer creates a new
artifact-ID directory exactly once and rejects an existing path before writing
any payload. The direct regression stages a verified artifact, attempts to
stage different bytes under the same ID, receives a deterministic rejection,
then re-reads the original payload and manifest successfully. This prevents a
later staging attempt from silently replacing verified bytes under a trusted
artifact identifier.

The release lifecycle test also stages an artifact, corrupts it before
activation, and proves that manifest verification happens before the active
pointer changes. It then corrupts the exact prior artifact and proves rollback
leaves the newer pointer active until the prior manifest passes verification;
the successful activation and rollback compare the selected entrypoints with
the verified on-disk manifest.

`scripts/release-readiness.mjs` also records the result of
`scripts/check-workspace-boundaries.mjs` in the deterministic release manifest.
The evidence includes the checker name, normalized workspace package list,
normalized violations, violation count, and a SHA-256 digest of that evidence.
The checked-in worktree currently records zero violations.

The same file-backed harness can attach a detached Ed25519 signature to the
exact manifest bytes and verify it with a caller-supplied trusted public key.
The focused test proves a payload mutation fails the hash check before
signature acceptance. This is local cryptographic evidence only; it does not
claim key distribution, signing-service custody, notarization, or publication.

These checks do not replace packaged installer execution, native architecture
probes, signing/notarization, publication, or hosted deployment gates.
