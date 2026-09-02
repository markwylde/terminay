# ADR Review

## In-force ADRs reviewed
- ADR-0001 — Pin the Node runtime, toolchain, and compile targets across every lane
- ADR-0002 — Use SQLite through `node:sqlite` for the server state repository
- ADR-0004 — Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix
- ADR-0006 — Use a Terminay-owned deterministic Werift ESM artifact as the headless WebRTC runtime

## Decisions recorded
_No durable architectural decisions were introduced by this change._ It
consumed the decisions taken by the preceding architecture spikes: ADR-0002
fixes the state repository that `server-core` composes behind its dispatch
boundaries, and ADR-0006's WebRTC runtime is deliberately kept out of the
protocol, client-core, and responsive-UI dependency sets by the boundary
checker introduced here.
