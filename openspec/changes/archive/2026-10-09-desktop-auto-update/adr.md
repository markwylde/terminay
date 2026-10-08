# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-19
- Reviewer: Claude (for Mark Wylde)
- Change: desktop-auto-update

## In-Force ADR Context Reviewed

These ADRs are in force; the supersession graph retires 0007, 0008, 0009, 0014
and 0024. The ones that bind this change:

- openspec/adr/0011-security-trust-boundary-model.md - renderer is untrusted;
  download, verification and install stay in the main process and the host
  action carries no URL, path or version.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md -
  the rolling `main-latest` channel this change extends with desktop payloads;
  its server-archive rules are unchanged.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - Desktop
  is a protocol-blind connection host; the updater is a host capability, not
  server state.
- openspec/adr/0001-pinned-node-runtime-baseline.md,
  openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - unchanged
  distribution matrix; macOS and Linux AppImage only.

## Repository-Level ADRs Created

- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md -
  in-place updates via `electron-updater`, integrity- and signature-checked,
  with channel metadata published last; Beta rides `main-latest`; channel is a
  device setting.

## Notes

The GitHub-API release-notes fetch and the Markdown sanitisation are tactical
and live in design.md only.
