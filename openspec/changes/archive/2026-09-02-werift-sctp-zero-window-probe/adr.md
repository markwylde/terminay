# ADR Review

## In-force ADRs reviewed

- ADR-0001 — Pin the Node runtime, toolchain, and compile targets across every lane
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0010 — Scope pull-request CI to a merge-confidence gate, sharded and provider-portable
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review
- ADR-0012 — Keep the installable PWA on the manager origin and frame the session origin

Relevance to this change:

- ADR-0006 is the governing decision. It selects a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime, on the basis that the artifact is minimized, pinned, and reproducible: pinned npm tarball, source commit, retained dependencies, notices, source correspondence, and SBOM, with two independent candidate builds producing an identical allowlist and hashes. This change adds a second patch to that artifact and therefore must extend every one of those pins rather than relax any. Generalizing the build script, the selection record, the server's load-time validation, and the release proofs from one patch to an ordered hash-pinned list is what keeps the decision's reproducibility property intact. The decision's own open items — native release certification and sustained real multi-peer ceilings — are unchanged by this change and remain outstanding.
- ADR-0007 is reviewed as historical context. It is superseded by ADR-0008 and is not in force, but it is the record of the practice this change follows for a different artifact: build the runtime archive deterministically on a trusted producer runner, ship no compiler, node-gyp input, or source tree in the extracted artifact, and prove the result by rebuild. The zero-window patch is attested and rebuilt on the same terms. It is referenced here as precedent only, and this change neither edits it nor revisits the decision that superseded it.
- ADR-0011 is why the load-time selection validation stays a refusal. The runtime is a trust-boundary component, and an artifact whose patch set, order, hashes, or purposes do not match its attestation must not load.
- ADR-0010 constrains where the determinism proof runs. Pull-request CI is a merge-confidence gate, so a full offline rebuild belongs in the release workflow where the runtime is already staged, and is bound into the release-evidence script so it cannot stop running unnoticed.
- ADR-0012 fixes the framed session host whose backgrounded tab is one of the two realistic ways a peer reaches a zero receive window.
- ADR-0001 pins the toolchain the deterministic rebuild depends on.

## Decisions recorded

_No durable architectural decisions were introduced by this change._

The runtime selection, its deterministic build, and its attestation model are ADR-0006's decision and are unchanged. Adding a patch and generalizing the governance from a single patch to an ordered hash-pinned list implements that decision at a further point; it establishes no new architectural commitment and supersedes no in-force ADR.
