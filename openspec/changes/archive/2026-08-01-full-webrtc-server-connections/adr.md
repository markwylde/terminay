# ADR Review

## In-force ADRs reviewed
- ADR-0003 — Hold server secrets in a vault with AES-256-GCM entries and platform key protectors
- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review

ADR-0006 governs this change directly: the audited published `node-datachannel` prebuild was
blocked by a native supply-chain finding, so the selected headless runtime is the
Terminay-owned deterministic secure-Werift ESM artifact, staged by release packaging and
verified before exposure. Its supporting spike is recorded at
`openspec/adr/evidence/secure-werift-production-spike.md`.

## Decisions recorded
_No durable architectural decisions were introduced by this change; it implements ADR-0006._
