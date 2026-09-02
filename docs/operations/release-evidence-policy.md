# Release evidence policy

Task 20 distinguishes three evidence classes. A passing local test is useful,
but it is not proof that a signed artifact was executed or published.

| Evidence class | What it proves | What it cannot satisfy |
| --- | --- | --- |
| `local-contract` | Deterministic local manifest, hash, signature-verification, or lifecycle behaviour. | Signed/notarized publication or native release-runner gates. |
| `native-runner` | A named native release runner executed the stated commands at a recorded UTC instant. | Publication, trusted signing, or notarization. |
| `published-artifact` | A named native runner plus a digest-pinned HTTPS artifact URI, publication time, and signer key identity. | Any unrecorded platform or installer behaviour. |

Before a release gate is checked, record the artifact and manifest SHA-256
values, the commands used, and the evidence classification. A release runner
record also needs its runner identity and UTC completion instant. A publication
record additionally needs an immutable `https://…@sha256:<digest>` URI, UTC
publication instant, and trusted signer-key identifier. To satisfy an external
publication gate, the verifier must also receive the exact artifact bytes and
its detached signature, hash those bytes against the evidence record, and
verify the signature through the root-authenticated signing-key distribution.

`scripts/task20-release-evidence.mjs` validates this boundary. In particular,
`requireExternalReleaseEvidence()` rejects local-contract and native-runner
records, so local fixtures cannot accidentally be used to claim signed
publication. It also rejects substituted artifact bytes or detached signatures
even when a record names a trusted key. This policy governs evidence only; it neither publishes images
nor substitutes for key custody, notarization, or supported-platform runs.
