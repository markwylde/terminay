# ADR Review

## In-force ADRs reviewed
- ADR-0011 — Adopt an explicit trust-boundary model as the security contract for release review. This change is the release review that model governs: every hardening item below names the boundary it defends, and the security-review acceptance check ("no unresolved critical or high boundary issue") is stated in the model's terms.
- ADR-0001 — Pin the Node runtime, toolchain, and compile targets across every lane. The native Linux x64/arm64 runner lanes and the packaged artifact contract depend on that pinning.
- ADR-0002 — Use SQLite through `node:sqlite` for the server state repository. The crash, corrupt, read-only, permission-denied, and full-disk state matrix exercises that repository.
- ADR-0003 — Hold server secrets in a vault with AES-256-GCM entries and platform key protectors. The vault was threat-modelled and its revocation, expiry, and redaction behaviour verified.
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix. The load, crash, and native-runner PTY probes exercise that model.
- ADR-0005 — Load server UI in a sandboxed, origin-bound partition in both Desktop and browser hosts. The Desktop security audit verifies that partition, its CSP and permissions policy, and same-origin navigation.
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime. The secure-Werift candidate reproducibility, provenance, verifier, vulnerability-response policy, and Chromium interoperability evidence belong to that decision.
- ADR-0007 — Build PTY runtime archives deterministically on a trusted producer runner (later superseded by ADR-0008). In force at the time of this change and reflected in the deterministic artifact and native-runner evidence contracts.

## Decisions recorded
_No durable architectural decisions were introduced by this change; it verified and hardened decisions already recorded elsewhere._
