## Why

On Pop!_OS and Ubuntu 24.04, Terminay 6.3.0's AppImage opens a project and
then cannot start a single terminal. Every attempt shows "Operation failed: The
terminal process could not be started", and the diagnostics say only that the
session holder exited before it was ready with exit code 1. The same happens on
any GNU/Linux host with glibc older than 2.42, including the Debian 12 hosts the
runtime matrix promises to support.

The cause is in the build, not in the user's machine. The bundled `pty.node`
was compiled on a GitHub `ubuntu-latest` runner whose glibc is 2.42, so it binds
`cfsetispeed@GLIBC_2.42` and `cfsetospeed@GLIBC_2.42`. glibc is only backward
compatible, so that addon cannot load on an older glibc. Nothing pins the
glibc a Linux artifact is built against. The supported floor is whatever
`ubuntu-latest` is that month, and nothing checks the shipped bytes against the
floor the spec states. The standalone x64 server archive is built the same way
and has the same exposure. When the holder failed, its error went to a stderr
nobody reads. node-pty's loader also reports only its last attempt, so even that
error said a prebuild was missing, not that glibc was too old.

## What Changes

- The supported GNU/Linux floor becomes glibc 2.31 (Debian 11, Ubuntu 20.04 and
  newer), which is Electron's own Linux baseline. It was Debian 12 / glibc 2.36.
  Ubuntu 22.04 LTS, which is still widely used, becomes supported.
- Every Linux artifact (the Desktop AppImage, the beta AppImage, and both
  standalone server archives) is built inside one pinned floor image,
  `node:24.15.0-bullseye` by digest. Native code is therefore compiled against
  glibc 2.31 whatever runner the job happens to land on.
- Before publication, a static check reads the symbol-version requirements of
  every ELF file of the target architecture in the artifact. It fails when any
  file needs a `GLIBC_`, `GLIBCXX_`, or `CXXABI_` version above the floor.
- A runtime probe runs the real artifact in a clean `debian:bullseye-slim`
  container that has no compiler and no Node. It starts the real session
  holder until it reports ready, then runs a shell through the packaged
  `node-pty`.
- Pull-request CI on Gitea builds the AppImage and the x64 server archive at the
  floor and runs both checks, so a regression is caught before merge rather
  than by a user.
- A session holder that cannot start reports why. Its entry loads `node-pty`
  under its own control. When the load fails, it names the dynamic-loader error
  of the addon that is present, and sends the reason back to the server that
  launched it. The launch-failed diagnostic then reads, for example, "version
  `GLIBC_2.42' not found".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: the supported runtime matrix states the glibc
  2.31 floor and that it holds for Desktop. A new requirement says Linux
  artifacts are built at the floor and verified against it, statically and at
  runtime, before merge and before publication.
- `local-desktop-diagnostics`: a holder launch that fails records the reason
  the holder gave, not only its exit status.

## Impact

- New: `Dockerfile.linux-floor`, `Dockerfile.linux-floor-runtime`,
  `scripts/linux-glibc-floor.mjs` (floor constants, ELF reader, check CLI),
  `scripts/run-in-linux-floor.sh`, `scripts/probe-linux-glibc-floor.sh`,
  `scripts/linux-glibc-floor-probe.mjs`,
  `scripts/build-linux-standalone-archive.sh`, `scripts/build-main-beta-desktop.sh`,
  and their tests.
- `.gitea/workflows/ci.yml`: a new `linux-glibc-floor` job.
- `.github/workflows/trigger-release.yml` and `main-prerelease.yml`: the Linux
  desktop and server-archive lanes build through the floor image, then check
  and probe before checksum, signing, or upload.
- `apps/terminay-server/src/sessionHolderEntry.ts`,
  `packages/server-core/src/sessionHolder/process.ts` and `factory.ts`: holder
  start-up failures are reported over the readiness descriptor.
- New ADR-0077 supersedes ADR-0035, which restated the glibc 2.36 matrix.
- Users on glibc 2.31–2.41 get working terminals once a release is cut from
  this change. Nothing changes for macOS.
