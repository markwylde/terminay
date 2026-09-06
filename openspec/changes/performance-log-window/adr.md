# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-06
- Reviewer: Mark Wylde
- Change: performance-log-window

## In-Force ADR Context Reviewed

Supersession graph walked across `openspec/adr/`: ADR-0008 supersedes ADR-0007; every other record is accepted and unsuperseded. ADR-0007 was treated as history only. Highest sequence in use: 0013.

- `0005-sandboxed-origin-bound-client-hosts.md` — governs this change directly. The Performance Log window is a sandboxed, origin-bound server-UI renderer with the same minimal preload as every other auxiliary window. Its capability is added as one closed-schema host action (`diagnostics.performance-snapshot.read`) plus one event, exactly as ADR-0005 requires of any new host capability; the window receives values computed in main, never a file path, handle, or log-reading capability.
- `0008-server-bundled-clients-and-protocol-blind-hosts.md` — governs this change directly. The window is a route on the server-bundled UI opened through the existing `route.present` / `native-window` auxiliary path, not a second Desktop-owned workspace renderer. Desktop stays protocol-blind: nothing about the application protocol is added or interpreted.
- `0011-security-trust-boundary-model.md` — reviewed against the boundary table. No new boundary is introduced. The one new capability sits on the existing `server UI bundle → client host` row and satisfies its invariant (origin/source/target/gesture checked by `bindServerUiWindow`, bounded payload). The `local control socket → Server` and `project → environment adapter` rows are deliberately untouched: per-terminal sampling reads the in-process authority's session snapshots and refuses remote environments rather than extending adapters with a resource-reporting surface.
- `0004-node-pty-and-supported-distribution-matrix.md` — reviewed. Per-terminal sampling reads pids that `node-pty` already exposes through `TerminalSessionSnapshot.pid` and the `terminalStarted` lifecycle hook. It supervises no additional child and does not change the PTY model. The declared distribution matrix is why only macOS and Linux process-tree readers are in scope.
- `0009-server-owned-project-environments.md` — reviewed. Routing stays server-derived; the change adds no environment-level capability and reports remote-environment sessions as unavailable rather than asking an adapter for usage.
- `0002-sqlite-state-repository.md` — reviewed. The timeline and samples are in-memory only for the current process; nothing is added to the state repository.
- `0001`, `0003`, `0006`, `0010`, `0012`, `0013` — reviewed, not relevant. No runtime pin, vault, WebRTC, CI, PWA-host, or pairing behaviour changes.

## Repository-Level ADRs Created

- None. No decision in this change meets the durable-commitment bar. The three notable choices are all applications of decisions already in force rather than new ones:
  - Feeding the splash phase line by re-issuing the `data:` loading document is a tactical implementation choice inside a document whose no-script, no-network property is already the spec's contract; it establishes no new pattern.
  - Running a second lightweight metrics collector separate from the opt-in one is a scoping decision inside `local-desktop-diagnostics`, bounded by that spec's enumerated content rules, not an architectural commitment.
  - Sampling per-terminal usage from the in-process authority instead of through an adapter contract is the existing ADR-0009 and ADR-0011 boundaries being honoured, not revisited. Should per-environment resource reporting ever be wanted for SSH or Puzed, that would be a new durable decision and would need its own ADR at that time.

## Notes

No in-force ADR is proposed for supersession. Design open questions concern the startup phase vocabulary's depth, which is a measurement question rather than an architectural one.
