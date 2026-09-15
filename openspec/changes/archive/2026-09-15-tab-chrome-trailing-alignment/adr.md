# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-15
- Reviewer: Mark Wylde
- Change: tab-chrome-trailing-alignment

## In-Force ADR Context Reviewed

- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted. This change is stylesheet-only: no privileged call, no Electron IPC, no protocol message.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - supersedes ADR-0008. The chrome stays in the one shared workspace bundle; no host-specific styling is introduced.
- openspec/adr/0012-pwa-framed-session-host.md - the framed browser session is the host without a keyboard, which is why the compact breadcrumb has to look like a control you can press.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0005, 0006, 0010, 0013, 0014, 0015, 0016, 0017, 0019, 0020, 0021, 0022. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It aligns two pieces of existing chrome within the presentation layer already in force.

## Notes

The highest ADR sequence number in use is 0022.
