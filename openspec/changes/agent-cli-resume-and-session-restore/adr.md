# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-06
- Reviewer: Mark Wylde
- Change: agent-cli-resume-and-session-restore

## In-Force ADR Context Reviewed

ADR-0008 supersedes ADR-0007. Highest sequence in use is 0014.

- openspec/adr/0001-pinned-node-runtime-baseline.md - no bearing.
- openspec/adr/0002-sqlite-state-repository.md - Terminay's own store, not a provider restore path.
- openspec/adr/0003-vault-interface-and-key-protectors.md - no credentials.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - conformance still uses the existing PTY runtime.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - clients still read only the reduced snapshot.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - not implicated.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - no host-specific resume path.
- openspec/adr/0009-server-owned-project-environments.md - constrains the design: restore binding stays environment-routed and must not read the server host's home for a remote terminal.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - constrains the design: real-CLI restore tests stay off the pull-request merge gate.
- openspec/adr/0011-security-trust-boundary-model.md - constrains the design: no wrapping the CLI; identity stays on provider artifacts; picker text is not evidence.
- openspec/adr/0012-pwa-framed-session-host.md - not implicated.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - not implicated.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - constrains the design: a Resume `Y` requires the real CLI's documented restore command, not a fixture UUID or a skipped test.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Binding restore commands without an argv UUID, and Codex resume without an open
handle, are corrections to behaviour the specs already describe (Resume `Y`,
and "a CLI that closes its journal must not rely on open-handle evidence
alone"). They stay in this change's spec deltas. ADR-0014 already forbids
claiming Resume from a test that did not drive the real restore command; this
change stops doing that.
