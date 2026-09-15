# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-15
- Reviewer: Mark Wylde
- Change: compact-switcher-close

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - supersedes ADR-0008. Close stays inside the existing renderer presentation: it dispatches the same window events and `closeProject` path the hidden tabs already use, and adds no host capability.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - supersedes ADR-0009. Close of a panel or project is sent only to the server that owns it, through the store and confirmation those tabs already use.
- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. No new privileged call, protocol command, or Electron IPC is introduced.
- openspec/adr/0012-pwa-framed-session-host.md - the framed browser session is the host without a keyboard, which is why the close control has to be visible rather than a shortcut.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - unchanged; no new origin or transport.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0006, 0010, 0013, 0014, 0015, 0016, 0019, 0020, 0021, 0022. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It restores a close affordance on the surface that replaced the tab strip, using the close paths already in force.

## Notes

The highest ADR sequence number in use is 0022.
