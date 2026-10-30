# ADR-0079: Desktop's macOS floor follows Electron to macOS 13

Status: accepted, supersedes ADR-0077
Date: 2026-10-30
Supersedes: ADR-0077

## Context

ADR-0077 restated the distribution matrix with "Desktop: macOS 12 or newer on
arm64". ADR-0004 chose macOS 12 because Electron 42 still ran there, and noted
that Electron drops macOS 12 in v44.

Electron supports its three newest majors. With Electron 45 released, Electron
42 receives no more security fixes, and every Electron release that does is
44 or newer. Electron 44 and 45 require macOS 13: their binary declares
`LSMinimumSystemVersion` 13.0, so macOS 12 refuses to launch it. Staying on a
supported Electron and keeping macOS 12 are no longer compatible.

An installed Desktop updates itself in place (ADR-0027). electron-updater
installs whatever the update metadata names, so without a guard a macOS 12
client would download and install a build it cannot launch, and lose its
working copy. electron-updater skips an update whose metadata declares a
`minimumSystemVersion` above the running system. It compares that value with
`os.release()`, which on macOS is the Darwin kernel version, so macOS 13 is
`22.0.0`. The updater in every shipped Desktop already performs this check.
electron-builder does not write the field into the update metadata.

## Decision

1. Decisions 1–5, 7, and 8 of ADR-0077 are unchanged.

2. **The distribution matrix has a macOS 13 floor for Desktop.** Desktop:
   macOS 13 Ventura or newer on arm64, and GNU/Linux x64. Everything else in
   ADR-0077 §6 is unchanged: Standalone Server on GNU/Linux x64 and arm64, a
   glibc 2.31 floor with `GLIBCXX_3.4.28` and `CXXABI_1.3.12` for every
   GNU/Linux target, the same out-of-matrix platforms, and one PTY
   implementation with a native `node-pty` build per target.

3. **Desktop tracks a supported Electron major.** The pinned Electron is one
   that still receives security fixes. When Electron moves a platform floor,
   the matrix moves with it in a record that supersedes this one.

4. **Update metadata declares the macOS floor.** Every macOS update metadata
   file, stable and beta, carries `minimumSystemVersion: 22.0.0`, added after
   packaging and required by the metadata verifier before publication. A client
   below the floor keeps the version it has.

## Consequences

- macOS 12 Desktop users stay on the last Electron 42 build and stop receiving
  updates. The standalone server, browser access, and Linux Desktop are
  unaffected.
- Desktop receives Chromium and Electron security fixes again.
- Raising the floor again is a superseding record plus a new metadata value,
  not a silent consequence of a dependency bump.

## Open items

- ADR-0077's open items carry over unchanged.
