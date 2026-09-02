# Task 20 release-evidence classification

Date: 2026-07-28

The release evidence classifier prevents the common release-readiness error of
promoting deterministic local artifact checks to signed or published artifact
proof. It requires exact artifact and manifest SHA-256 values for every record
and separates local contract, native-runner, and published-artifact claims.

The focused regression command is:

```sh
node --test scripts/task20-release-evidence.test.mjs
```

The test proves that a local-contract record is accepted only as local evidence
and is rejected for an external publication gate; runner-only evidence remains
insufficient; and a publication claim requires a digest-pinned HTTPS URI,
native-runner record, UTC timestamps, and a signer key that resolves through a
verified root-authenticated distribution, is not revoked, and was valid at the
claimed publication instant. The external gate also requires the exact release
manifest bytes and verifies them against the record's manifest SHA-256, so a
record cannot bind the artifact correctly while silently substituting or
omitting the manifest that describes its matched server and UI.
The root-authenticated key distribution additionally validates the parsed SPKI
type as Ed25519, and detached verification recomputes the artifact SHA-256 from
the signed bytes. An algorithm label or caller-supplied digest is therefore
not treated as proof by itself.

This is a local policy/tooling control. It does **not** prove a signed,
notarized, published, or native-runner artifact exists. Those Task 20
requirements remain external operational follow-ups until evidence is recorded
from the relevant release environment.
