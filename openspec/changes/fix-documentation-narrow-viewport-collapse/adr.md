# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-02
- Reviewer: Mark Wylde
- Change: fix-documentation-narrow-viewport-collapse

## In-Force ADR Context Reviewed

Supersession graph: ADR-0008 supersedes ADR-0007; no other ADR carries a `Supersedes` field. ADR-0007 is therefore historical and did not constrain this design. Highest sequence in use: 0012.

- openspec/adr/0012-pwa-framed-session-host.md - Establishes the iOS installable PWA framing the session origin fullscreen, which makes phone-sized viewports a supported presentation of the workspace UI rather than an edge case. Directly motivates the change.
- openspec/adr/0008-server-bundled-clients-and-protocol-blind-hosts.md - The workspace UI ships from the server and hosts are protocol-blind; a renderer stylesheet correction stays entirely inside the server-bundled UI and touches no host.
- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - Server UI runs in a sandboxed origin-bound partition; the change adds no capability at that boundary.
- openspec/adr/0011-security-trust-boundary-model.md - Confirms this change crosses no trust boundary: it is presentation-only, with no authority, secret, or path handling.
- openspec/adr/0010-provider-portable-parallel-pull-request-ci.md - The regression test runs in the existing sharded Electron end-to-end lane rather than adding a new harness.
- openspec/adr/0001-pinned-node-runtime-baseline.md - Reviewed; no toolchain or compile-target impact.
- openspec/adr/0002-sqlite-state-repository.md - Reviewed; no persistence impact.
- openspec/adr/0003-vault-interface-and-key-protectors.md - Reviewed; no secret handling.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - Reviewed; no PTY or distribution impact.
- openspec/adr/0006-terminay-owned-werift-webrtc-runtime.md - Reviewed; no transport impact.
- openspec/adr/0009-server-owned-project-environments.md - Reviewed; no project-environment impact.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

The change corrects a media-query scoping error in `src/components/file-viewer/fileViewer.css` so the Documentation panel's narrow-viewport grid matches the surfaces it actually renders. The choice to key the stacked layout off the existing `--with-preview` / `--with-status` modifiers is a local stylesheet convention already used by the base rules, not a new architectural commitment, and it binds no future change.
