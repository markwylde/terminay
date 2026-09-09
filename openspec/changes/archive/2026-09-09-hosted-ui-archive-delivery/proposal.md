## Why

A device paired with a standalone server reaches a page reading "Terminay
workspace is connected." and nothing else. The transport is healthy — ICE
connects, channels open, the device is approved — and the workspace never
appears.

Two independent defects produce that, and the first hides the second.

The daemon CLI writes the renderer directory as `TERMINAY_UI_BUNDLE`. The
server reads it as `TERMINAY_UI_RENDERER_DIRECTORY`. Nothing reconciles the
two, so the server sees no renderer directory, never wires `getUiArchive`, and
falls back to a placeholder archive whose whole body is that sentence.

Setting the variable the server reads then fails differently: the server exits
at startup with `Hosted UI archive entry server.html is missing`. The archive
stages `dist`, the Desktop renderer bundle, whose entry is `remote.html`. The
hosted UI archive wants `dist-web`, the server-served workspace UI, whose entry
is `server.html` — the directory Desktop itself passes as its renderer
directory.

So the hosted workspace UI has never been delivered from a standalone archive.
The placeholder made it look like a rendering problem rather than a missing
bundle, and no check anywhere compares what the archive ships against what the
server will ask for.

## What Changes

- The daemon CLI writes the renderer directory under the name the server reads,
  and keeps writing the local UI bundle path under its own name. They are two
  settings that happen to share a value, not one setting with two spellings.
- The standalone archive stages the server-served workspace UI rather than the
  Desktop renderer bundle, so `ui/` contains the entry the hosted archive
  loader asks for.
- The archive build fails when the staged UI cannot satisfy the hosted archive
  loader, and the archive probe fails when an already-built archive cannot.
  A published archive that cannot serve a workspace is the defect this change
  exists to remove; it should never be publishable again.
- **BREAKING** for an operator who set `TERMINAY_UI_BUNDLE` by hand expecting it
  to drive the hosted workspace: that variable now only serves the local HTTP
  UI, and the hosted archive needs `TERMINAY_UI_RENDERER_DIRECTORY`. Installs
  made by the CLI are unaffected — it writes both.

## Capabilities

### Modified Capabilities

- `server-runtime-and-protocol`: the standalone artifact must carry a UI bundle
  the hosted archive loader can serve, and that is verified when the archive is
  built and when it is probed.
- `daemon-cli`: the service environment names the renderer directory the server
  reads.

## Impact

- `scripts/build-standalone-server-artifact.mjs`: stage `dist-web`; fail when
  the staged UI has no hosted entry.
- `scripts/probe-standalone-server-archive.mjs`: assert the entry is present in
  a built archive.
- `.github/workflows/trigger-release.yml`: the archive job builds the
  server-served UI bundle it now stages.
- `apps/terminay-cli/src/unit.ts`: write `TERMINAY_UI_RENDERER_DIRECTORY`.
- No protocol change. An existing paired device reconnects and receives the
  real workspace where it previously received the placeholder.
