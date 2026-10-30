## Context

Electron 42 is out of support. Electron 44 removed macOS 12 and made the main
process clipboard asynchronous. Electron 45 restricts sandboxed preloads to the
`electron` modules and drops their `Buffer`, `setImmediate`, and Node shims,
records content traces only as Perfetto protobuf, and gives `window.open()`
children their own sandboxed process.

## Decisions

### Electron 45, not 43

Electron 43 would keep macOS 12, but it leaves support when Electron 46 ships,
and the floor moves then anyway. Moving now puts Desktop on the newest
supported major and makes the floor change once.

### Smart paste reads the clipboard as items

`clipboard.read()` returns W3C-style items. Copied files arrive as
`text/uri-list`, text as `text/plain`,
and images as `image/png`. Smart paste keeps its order (files, then text, then
an image materialised as a temporary PNG) and its shell escaping. It is still a
main-process capability bound to a user gesture, so the renderer gains no
clipboard read access. This keeps the boundary that renderer code is untrusted
and gets no ambient Electron access.

### The update guard lives in the published metadata

Installed clients run the electron-updater version they shipped with, so a
guard in new client code cannot protect them. Every shipped updater honours
`minimumSystemVersion` in the update metadata, comparing it with
`os.release()`. On macOS that is the Darwin version, so the value is `22.0.0`,
not `13.0`. electron-builder does not write it, so a small script appends it
after packaging. The verifier requires it on both channels, so a lane that
forgets it fails before publication rather than on a user's machine. Beta
metadata that survives from an earlier run is not required to carry it.

### Preload and window behaviour

Every window is sandboxed, and the only preload uses `electron` and Web APIs,
so the preload restrictions change nothing. Every `setWindowOpenHandler` denies
or routes externally, so the `window.open()` change does not apply.

### Trace files

Electron 45 writes only Perfetto protobuf, so traces are named `.pftrace`. The
managed-artifact pattern accepts `.json` as well, so traces from earlier builds
are still recognised, expire, and are removed by Clear Diagnostics instead of
becoming unrecognised files that Terminay never deletes.

## Risks

- A macOS 12 user is told nothing; their update check simply finds nothing
  newer. Accepted. The alternative is a broken install.
- Electron 45's Linux binary must still meet the glibc 2.31 floor. The floor
  check and runtime probe in pull-request CI prove it on the AppImage bytes.
