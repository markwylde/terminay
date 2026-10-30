# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-30
- Reviewer: Claude (for Mark Wylde)
- Change: extension-installer-on-npm-libraries

## In-Force ADR Context Reviewed

- openspec/adr/0078-pinned-node-runtime-baseline-on-npm-12-2-1.md - makes the
  bundled installer the pinned npm CLI and accepts that its advisories lag npm
  releases. Superseded by 0080, which keeps its toolchain baseline unchanged.
- openspec/adr/0011-security-trust-boundary-model.md - unchanged. The installer
  stays a bounded, privileged server child; nothing moves to the renderer.
- openspec/adr/0079-desktop-macos-floor-follows-electron-to-macos-13.md -
  unchanged. The worker runs under the same Electron through
  `ELECTRON_RUN_AS_NODE`.

## Repository-Level ADRs Created

- openspec/adr/0080-extension-installer-is-built-from-npm-libraries.md - the
  installer is `pacote` and `@npmcli/arborist` as ordinary, overridable
  dependencies in a bounded child process; npm stays a build tool only.

## Notes

- Add the 0080 row to `openspec/adr/README.md` and mark 0078 superseded in the
  index when this change is applied.
