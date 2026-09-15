# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-15
- Reviewer: Mark Wylde
- Change: compact-command-bar-entry

## In-Force ADR Context Reviewed

- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - supersedes ADR-0008 and holds the current host boundary: hosts are protocol-blind presentation shells supplying a frozen host context. This change stays inside it — the browser menu entries and the compact control dispatch through the shared command model, and `renderCompactApplicationMenu` remains the only host-supplied menu seam.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - supersedes ADR-0009. The editing commands act on the project and terminal in front, on their own server, adding no cross-server path.
- openspec/adr/0011-security-trust-boundary-model.md - renderer code is untrusted at every privileged boundary. No new privileged call is introduced; the editors open through the host's existing auxiliary-route presentation.
- openspec/adr/0012-pwa-framed-session-host.md - the framed browser session host is the surface where the keyboard is absent, which is what motivates the chrome control.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - unchanged; no new origin or transport is involved.
- Also reviewed and not engaged by this change: 0001, 0002, 0003, 0004, 0006, 0010, 0013, 0014, 0015, 0016, 0019, 0020. Superseded and treated as history only: 0007 (by 0008), 0008 (by 0018), 0009 (by 0017).

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change. It extends the application-command model that **Show Dashboard** already established and adds one presentation control; no boundary, dependency, or pattern changes.

## Notes

The highest ADR sequence number in use is 0020.
