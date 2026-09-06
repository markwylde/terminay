# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-06
- Reviewer: Grok
- Change: remove-locked-git-worktrees

## In-Force ADR Context Reviewed

- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - Git removal stays on the server; the client still submits opaque identities, not paths or Git argv.
- openspec/adr/0011-security-trust-boundary-model.md - a Git worktree lock is not a project, session, or authorization boundary; confirmed delete remains a server mutation under existing write scope.
- openspec/adr/0001-pinned-node-runtime-baseline.md - reviewed, not relevant.
- openspec/adr/0002-sqlite-state-repository.md - reviewed, not relevant.
- openspec/adr/0003-vault-interface-and-key-protectors.md - reviewed, not relevant.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - supported hosts include Git new enough for double `--force` worktree remove.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - reviewed, not relevant.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - reviewed, not relevant.
- openspec/adr/0009-server-owned-project-environments.md - reviewed, not relevant.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - reviewed, not relevant.
- openspec/adr/0012-pwa-framed-session-host.md - reviewed, not relevant.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - reviewed, not relevant.
- openspec/adr/0014-declared-provider-capabilities-proven-against-real-clis.md - reviewed, not relevant.

ADR-0007 is superseded by ADR-0008 and was treated as history only.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

Tactical Git flag and pre-check change inside the existing server Git authority. Recorded in design.md.
