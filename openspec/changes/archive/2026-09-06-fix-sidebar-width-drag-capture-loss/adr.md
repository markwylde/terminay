# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-06
- Reviewer: Mark Wylde
- Change: fix-sidebar-width-drag-capture-loss

## In-Force ADR Context Reviewed

- openspec/adr/0001-pinned-node-runtime-baseline.md - Runtime baseline; untouched by a renderer pointer fix.
- openspec/adr/0002-sqlite-state-repository.md - Workspace persistence; the committed width still travels the existing sidebar command.
- openspec/adr/0003-vault-interface-and-key-protectors.md - Secret handling; not involved.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - PTY and distribution matrix; not involved.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - Client host sandboxing; the change stays inside the existing renderer bundle.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - Remote transport runtime; not involved.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - Supersedes ADR-0007. The width separator lives in the server-bundled workspace UI shared by every host, so the fix applies to Desktop and browser alike without host-specific code.
- openspec/adr/0009-server-owned-project-environments.md - Environment routing; not involved.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - The new end-to-end coverage runs in the existing containerised Playwright job.
- openspec/adr/0011-security-trust-boundary-model.md - Renderer stays untrusted; no new authority is introduced.
- openspec/adr/0012-pwa-framed-session-host.md - Framed session host; unaffected.
- openspec/adr/0013-device-bound-host-approval-and-channel-only-credentials.md - Device trust; not involved.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The design aligns the sidebar width separator with the pointer-gesture handling
the vertical pane stack already uses. That is a component-level correction
inside one renderer capability, not a new architectural commitment.
