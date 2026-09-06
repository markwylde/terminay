# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-06
- Reviewer: Mark Wylde
- Change: fix-grok-concurrent-session-binding

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - Runtime baseline; untouched.
- openspec/adr/0002-sqlite-state-repository.md - Persistence; no schema change.
- openspec/adr/0003-vault-interface-and-key-protectors.md - Secrets; not involved.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - PTY matrix; binding stays process-tree scoped.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - Client hosts; not involved.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - Remote transport; not involved.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - Supersedes ADR-0007. Observation stays in the server-owned Grok extension child.
- openspec/adr/0009-server-owned-project-environments.md - Environment routing; This-server observation is unchanged.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - New unit coverage is on the merge gate; Electron e2e stays in the existing Docker job.
- openspec/adr/0011-security-trust-boundary-model.md - Journals stay privileged. The registry join is pid-to-session, never cwd identity.
- openspec/adr/0012-pwa-framed-session-host.md - Framed session host; unaffected.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - Device trust; not involved.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - Grok owns this binding proof and its fixtures.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Selecting among matching `active_sessions.json` descendant pids is a Grok
provider binding correction inside the existing observation contract. It does
not change how Terminay Server authorizes terminals or how clients subscribe.
