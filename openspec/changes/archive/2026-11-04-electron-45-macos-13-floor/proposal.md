## Why

Terminay Desktop runs on Electron 42, which stopped receiving security fixes
when Electron 45 shipped: Electron supports only its three newest majors. Its
open advisories (Dependabot lists seven against it) can only be fixed by moving
to a supported major. Every supported Electron, from 44 onward, requires
macOS 13, and the runtime matrix promises Desktop on macOS 12.

Desktop also updates itself in place. Shipping a macOS 13-only build through
the existing update metadata would make every macOS 12 install download an
update it cannot launch, and lose the copy that works.

## What Changes

- Desktop moves to Electron 45. Its clipboard API is asynchronous, so smart
  paste reads files, text, and images through `clipboard.read()`.
- The Desktop macOS floor becomes macOS 13 Ventura. The standalone server,
  browser access, and Linux Desktop are unchanged.
- Every macOS update metadata file, stable and beta, declares
  `minimumSystemVersion: 22.0.0` (Darwin 22 is macOS 13). The metadata verifier
  requires it before publication, so a macOS 12 install keeps the version it
  has instead of updating to one it cannot launch.
- Chromium performance traces are written as Perfetto protobuf, the only format
  Electron 45 records, and named `.pftrace`. Earlier `.json` traces still expire
  under the same retention rules.

## Capabilities

### Modified Capabilities

- `server-runtime-and-protocol`: the supported runtime matrix's Desktop macOS
  floor is macOS 13.
- `settings-shortcuts-and-desktop-integration`: macOS update metadata declares
  the oldest system it runs on, and a Desktop below it keeps its version.

## Impact

- macOS 12 users stay on the last Electron 42 Desktop build.
- `electron/main.ts` smart paste, `electron/diagnostics/` trace naming,
  `scripts/verify-update-metadata.mjs`, the new
  `scripts/declare-update-minimum-system-version.mjs`, and both release
  workflows.
- ADR-0079 supersedes ADR-0077.
