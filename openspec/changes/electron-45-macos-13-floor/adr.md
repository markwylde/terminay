# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-30
- Reviewer: Claude (for Mark Wylde)
- Change: electron-45-macos-13-floor

## In-Force ADR Context Reviewed

- openspec/adr/0077-linux-artifacts-are-built-and-verified-at-a-declared-glibc-floor.md -
  restates the matrix with a macOS 12 Desktop floor in decision 6. Superseded
  by 0079, which restates every other decision unchanged.
- openspec/adr/0004-node-pty-and-supported-distribution-matrix.md - origin of
  the macOS 12 floor; already superseded.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md -
  unchanged. Metadata is still published last; it gains one field.
- openspec/adr/0005-* and 0011-security-trust-boundary-model.md - unchanged.
  Smart paste stays a main-process capability; the renderer gains nothing.

## New ADRs

- openspec/adr/0079-desktop-macos-floor-follows-electron-to-macos-13.md
