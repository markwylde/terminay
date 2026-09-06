# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-06
- Reviewer: Mark Wylde
- Change: agent-provider-status-conformance

## In-Force ADR Context Reviewed

All thirteen existing repository-level ADRs are currently in force; none carries
a `Supersedes:` field, so the supersession graph is empty and the highest
sequence in use was 0013.

- openspec/adr/0001-pinned-node-runtime-baseline.md - no bearing on provider observation.
- openspec/adr/0002-sqlite-state-repository.md - concerns Terminay's own state store, not a third-party provider's; reading OpenCode's `opencode.db` read-only is outside its scope.
- openspec/adr/0003-vault-interface-and-key-protectors.md - no credential handling in this change; provider CLIs hold their own auth.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - the conformance suite runs through the existing PTY runtime and adds no distribution requirement.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - unchanged; clients still read only the reduced snapshot.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - not implicated.
- openspec/adr/0007-deterministic-pty-runtime-archives.md - not implicated.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - the new provider surfaces reach clients through the existing ordered snapshot; no host-specific path is added.
- openspec/adr/0009-server-owned-project-environments.md - constrains the design: provider observation stays environment-routed, so OpenCode and Claude Code discovery must never reach the server's own home when the terminal runs elsewhere.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - constrains the design: the real-CLI conformance suite is kept off the pull-request merge gate. Whether a scheduled lane is added is raised as an open question in design.md rather than decided here.
- openspec/adr/0011-security-trust-boundary-model.md - constrains the design: the extension-child and untrusted-provider-binary boundaries govern the zero-injection rule and the OpenCode privacy boundary (conversation payloads never leave the extension child).
- openspec/adr/0012-pwa-framed-session-host.md - not implicated.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - not implicated.

## Repository-Level ADRs Created

- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - agent providers declare a per-capability verdict, every claim and every declared gap is verified against the provider's real authenticated CLI, fixtures must reproduce evidence the real CLI actually presents, and that verification stays off the pull-request merge gate.

## Notes

The Claude Code binding fix and the conditional interpreter claim are corrections
to behaviour the specs already describe; they are tactical and are recorded as
spec deltas, not as durable decisions.

The OpenCode SQLite read path is deliberately not recorded as an ADR. design.md
leaves open whether it belongs behind a new bounded read-only accessor in the
Extension API or inside the extension child's existing `agent-observation`
permission. That question should be settled before the OpenCode tasks begin, and
if it resolves toward a new public API surface it warrants its own ADR at that
point.
