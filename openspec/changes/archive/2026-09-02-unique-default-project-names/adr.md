# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-02
- Reviewer: Mark Wylde
- Change: unique-default-project-names

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - runtime baseline; unaffected.
- openspec/adr/0002-sqlite-state-repository.md - workspace state persistence; the derived name is stored through the existing project record, adding no schema.
- openspec/adr/0003-vault-interface-and-key-protectors.md - secrets; not touched.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - PTY runtime; not touched.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - client host sandboxing; this moves work out of the sandboxed renderer, which it favours.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - transport; not touched.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - supersedes ADR-0007; clients now send one less derived value, so hosts stay protocol-blind.
- openspec/adr/0009-server-owned-project-environments.md - the server owns the project record; deriving the default name server-side follows that ownership rather than crossing it.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - CI shape; new tests run in the existing server-core suite.
- openspec/adr/0011-security-trust-boundary-model.md - the renderer is untrusted at privileged boundaries; removing a client-derived value from a server-applied command is consistent with it.
- openspec/adr/0012-pwa-framed-session-host.md - session host framing; not touched.

ADR-0007 is superseded by ADR-0008 and was read as history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Moving default-name derivation into the `project.create` reducer applies the
existing server-ownership commitment recorded in ADR-0009 and ADR-0011 rather
than establishing a new one, so no ADR is warranted.
