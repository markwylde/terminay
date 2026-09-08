# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-08
- Reviewer: Mark Wylde
- Change: fix-stale-reconcile-panel-removal

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - runtime and compile
  targets; unchanged by a client-side scheduling fix.
- openspec/adr/0002-sqlite-state-repository.md - server state persistence; this
  change persists nothing new.
- openspec/adr/0003-vault-interface-and-key-protectors.md - secret handling; not
  touched.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - one
  supervised child per PTY. Relevant as the stake: the defect ends live PTYs by
  closing their canonical panels.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the renderer this
  change edits runs in the sandboxed, origin-bound partition; it gains no new
  authority.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - WebRTC runtime; not
  touched.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md
  (supersedes ADR-0007) - the workspace UI ships from the server and hosts stay
  protocol-blind. The fix stays wholly inside that server-bundled UI.
- openspec/adr/0009-server-owned-project-environments.md - environment ownership;
  not touched.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - the
  merge-confidence gate that runs this change's end-to-end coverage.
- openspec/adr/0011-security-trust-boundary-model.md - project/window and
  terminal-session boundaries. Honoured: presentation is scoped more tightly, and
  no boundary is widened.
- openspec/adr/0012-pwa-framed-session-host.md - session host framing; not
  touched.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md -
  pairing and credentials; not touched.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md -
  agent provider conformance; not touched.

ADR-0007 is superseded by ADR-0008 and was read as history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The design decision — a deferred reconciliation pass reads the store's confirmed
projection instead of the snapshot that scheduled it — is a correctness fix
within an established contract (`Snapshot, revision, and named commands`, and
`Command-first terminal panel close`), not a new architectural commitment. It is
recorded as a requirement in the `server-owned-workspace-state` delta spec.
