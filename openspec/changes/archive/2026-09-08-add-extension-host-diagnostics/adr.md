# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-08
- Reviewer: Mark Wylde
- Change: add-extension-host-diagnostics

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - the governing record here: its **Server → extension child** row (namespaced bounded IPC, crash isolation, extension code trusted but fallible) and its **vault/migration/logging → operators** row (only metadata crosses transport, secret bytes never logged) bound both the fatal-error frame and the verbatim error text.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - agent provider observation contract; the new agent admission records describe observation outcomes without changing what a provider must prove.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - confirms diagnostics stay out of renderer reach; no renderer-facing surface is added.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md (supersedes ADR-0007) - hosts stay protocol-blind; the new records leave server-core through injected callbacks rather than a host-specific import.
- openspec/adr/0009-server-owned-project-environments.md - restart supervision stays inside the server's extension composition, which owns environment and extension lifecycle.
- openspec/adr/0001, 0002, 0003, 0004, 0006, 0010, 0012, 0013, 0015, 0016 - reviewed; runtime baseline, state repository, vault, PTY matrix, WebRTC runtime, CI, session host, device approval, signaling exposure, and release archives are untouched by this change.
- openspec/adr/0007-deterministic-pty-runtime-archives.md - superseded by ADR-0008; historical context only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The two decisions that come closest to the bar are recording extension error text verbatim and restarting a failed host automatically. Both are settled inside the boundaries ADR-0011 already fixes — the first states positively what the existing logging invariant excludes rather than relaxing it, and the second implements the backoff and quarantine policy `ExtensionHost` already computes. Neither establishes a new pattern for future changes, so both stay in design.md.
