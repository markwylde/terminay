# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-19
- Reviewer: Mark Wylde
- Change: fix-compact-switcher-new-terminal-activation

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - supersedes ADR-0008. The fix stays in the shared renderer presentation and reuses the workspace handle's existing command dispatch; no host capability is added.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - supersedes ADR-0009. The terminal is still created through the owning project's server client, after that server and project are selected.
- openspec/adr/0011-security-trust-boundary-model.md - no new privileged call, protocol command, or Electron IPC.
- openspec/adr/0012-pwa-framed-session-host.md - the framed PWA session is the host where the compact switcher is the only create route, which is why the defect is felt there.
- Also reviewed and not engaged by this change: 0001–0006, 0010, 0013–0016, 0019–0027. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It routes an existing control through the creation path already in force.

## Notes

The highest ADR sequence number in use is 0027.
