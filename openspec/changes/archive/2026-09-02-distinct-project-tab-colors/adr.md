# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-02
- Reviewer: Mark Wylde
- Change: distinct-project-tab-colors

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - runtime baseline; no bearing on UI colour selection.
- openspec/adr/0002-sqlite-state-repository.md - server state persistence; this change stores no new state.
- openspec/adr/0003-vault-interface-and-key-protectors.md - secrets; not touched.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - PTY runtime; not touched.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - client host sandboxing; selection stays in the sandboxed renderer, which it permits.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - transport; not touched.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - supersedes ADR-0007; the colour default is chosen in the server-bundled workspace UI and committed through the existing project-creation call, so hosts stay protocol-blind.
- openspec/adr/0009-server-owned-project-environments.md - the server still owns the project record and its colour; the renderer only proposes a creation-time default.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - CI shape; unit tests added by this change run in the existing suites.
- openspec/adr/0011-security-trust-boundary-model.md - renderer is untrusted at privileged boundaries; a presentation default crosses no such boundary.
- openspec/adr/0012-pwa-framed-session-host.md - session host framing; not touched.

ADR-0007 is superseded by ADR-0008 and was read as history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The farthest-hue selection rule is a local algorithm inside
`src/workspace/projectTabModel.ts` with an unchanged public surface. It sets no
long-term architectural commitment, introduces no dependency, and crosses no
trust or ownership boundary, so it stays in design.md rather than becoming an ADR.
