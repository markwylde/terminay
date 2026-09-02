# ADR-0004: Keep `node-pty` with one supervised child per PTY, and declare a bounded distribution matrix

Status: accepted
Date: 2026-07-27

## Context

Terminal sessions are the product's core capability, and the PTY layer is the
only part of the server that requires a native module. The existing host logic
worked, but it was written for Electron, which made it impossible to reuse in a
standalone server without carrying Electron along with it.

Supporting every platform from the outset would multiply the native artifact
matrix and the release evidence required for each lane, so the supported set has
to be declared rather than assumed.

## Decision

Terminay keeps `node-pty` and one supervised child per PTY. The Electron-free
host logic becomes a reusable server module with a small typed process-IPC entry
adapter.

The initial supported distribution matrix is:

- Desktop: macOS 12 Monterey or newer on arm64, and GNU/Linux x64;
- standalone Server: GNU/Linux x64 and arm64 on Debian 12-compatible hosts with
  glibc 2.36 or newer.

macOS x64, Linux arm64 Desktop, Windows, standalone macOS/Windows Server, and
Alpine/musl Linux are outside the initial matrix.

Electron 42.7.1 is the pinned Desktop runtime. Electron removes Monterey support
only in v44 and states that earlier releases continue to run on Monterey, so the
supported Electron 42 macOS floor is macOS 12 rather than the current build
runner version. See Electron's
[macOS 12 removal notice](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support).

Standalone distributions are platform archives containing a pinned Node runtime,
bundled server JavaScript, the matching responsive UI, target-specific
`node-pty` native files and helpers, and a `terminay-server` launcher. Desktop
supervises that exact server payload and does not contain a second PTY
implementation.

## Consequences

- There is one PTY implementation to qualify, shared by Desktop and standalone.
- Every supported target needs its own native `node-pty` build produced by the
  release pipeline; adding a platform is a deliberate matrix expansion, not a
  configuration flag.
- Users on excluded platforms have no supported path until the matrix is widened.

## Open items

The same executable probe must run against development Node, Electron Node mode,
the extracted standalone archive, and the packaged Desktop payload, verifying
spawn, cwd, UTF-8, interactive input, resize, process inspection, inactivity,
exit and signal propagation, descendant cleanup, and bounded shutdown on every
supported native architecture. That coverage is a release gate, not an assumed
property of the choice.
