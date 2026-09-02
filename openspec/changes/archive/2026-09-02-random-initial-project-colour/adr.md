# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-02
- Reviewer: Mark Wylde
- Change: random-initial-project-colour

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - runtime baseline; unaffected.
- openspec/adr/0002-sqlite-state-repository.md - state persistence; no stored shape changes.
- openspec/adr/0003-vault-interface-and-key-protectors.md - secrets; not touched. `Math.random` is a presentation default, never a security value.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - PTY runtime; not touched.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - client host sandboxing; selection stays in the sandboxed renderer.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - transport; not touched.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - supersedes ADR-0007; the colour is still chosen in the bundled UI and committed through the existing creation call.
- openspec/adr/0009-server-owned-project-environments.md - the server still owns the project record and its colour.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - CI shape; tests run in the existing suite.
- openspec/adr/0011-security-trust-boundary-model.md - a presentation default crosses no privileged boundary.
- openspec/adr/0012-pwa-framed-session-host.md - session host framing; not touched.

ADR-0007 is superseded by ADR-0008 and was read as history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Randomising one branch of a local selection function sets no architectural
commitment. `Math.random` is used for a cosmetic default only and is never a
security or identity value.
