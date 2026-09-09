# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-09
- Reviewer: Mark Wylde
- Change: fix-host-channel-loss-crash-counting

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the governing record: its **Server → extension child** row makes crash isolation the invariant for this boundary, and its threat note that the child boundary "contains normal crashes and API mistakes but is not represented as a hostile-code sandbox" is the distinction this change restores — a closed channel is a normal crash, not misbehaviour to be contained.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - provider observation contract; the discovery backoff preserves late binding, which is what that record's proven-against-real-CLI behaviour depends on.
- openspec/adr/0009-server-owned-project-environments.md - extension and environment lifecycle stays server-owned; crash counting and restart remain inside that authority.
- openspec/adr/0001, 0002, 0003, 0004, 0005, 0006, 0008, 0010, 0012, 0013, 0015, 0016 - reviewed; runtime baseline, state repository, vault, PTY matrix, client hosts, WebRTC runtime, bundled clients, CI, session host, device approval, signaling exposure, and release archives are untouched.
- openspec/adr/0007-deterministic-pty-runtime-archives.md - superseded by ADR-0008; historical context only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The nearest candidate is distinguishing a closed channel from a protocol violation, since it decides what the child process boundary is for. Measured against ADR-0011 it is a correction rather than a new commitment: that record already says the boundary contains ordinary crashes and is not a hostile-code sandbox, and counting a dying child's closed channel as misbehaviour contradicted it. Nothing here establishes a pattern future changes must follow, so it stays in design.md.
