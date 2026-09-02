# ADR Review

## In-force ADRs reviewed

_None — this change ran before any ADR existed; it is the change that produced
the first ones._

## Decisions recorded

- `openspec/adr/0001-pinned-node-runtime-baseline.md` — Pin the Node runtime,
  toolchain, and compile targets across every lane.
- `openspec/adr/0002-sqlite-state-repository.md` — Use SQLite through
  `node:sqlite` for the server state repository.
- `openspec/adr/0003-vault-interface-and-key-protectors.md` — Hold server
  secrets in a vault with AES-256-GCM entries and platform key protectors.
- `openspec/adr/0004-node-pty-and-supported-distribution-matrix.md` — Keep
  `node-pty` with one supervised child per PTY, and declare a bounded
  distribution matrix.
- `openspec/adr/0005-sandboxed-origin-bound-client-hosts.md` — Load server UI
  in a sandboxed, origin-bound partition in both Desktop and browser hosts.
- `openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md` — Use a
  Terminay-owned deterministic Werift ESM artifact as the headless WebRTC
  runtime.
