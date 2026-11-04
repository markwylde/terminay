## Context

Four lanes produce Linux bytes that users run, all on the GitHub mirror:
`trigger-release.yml`'s Linux desktop lane and its two standalone archive lanes,
and `main-prerelease.yml`'s archive and beta desktop lanes. Each runs `npm ci`
and the build directly on the runner. `node-pty` 1.1.0 ships no Linux prebuild,
so its addon is compiled there by node-gyp. electron-builder's default
`npmRebuild` compiles it again while packaging. The glibc symbol versions a
binary needs are fixed by the glibc it was linked against. On an `ubuntu-latest`
image with glibc 2.42, `cfsetispeed` and `cfsetospeed` bind to their new
`GLIBC_2.42` versions. The 6.3.0 AppImage's `pty.node` therefore cannot load
below glibc 2.42. Every other ELF file in that AppImage needs 2.25 or less.

ADR-0007 named this open item ("Linux glibc compatibility depends on the
producer environment"), and no ADR since has closed it.

## Goals / Non-Goals

**Goals:**

- The glibc a Linux artifact needs is decided by the repository, not by the
  runner image.
- A Linux artifact that needs more than the floor never merges and never
  publishes.
- A holder that cannot start says why in the diagnostics.

**Non-Goals:**

- musl/Alpine, Linux arm64 Desktop, or any other matrix expansion.
- Shipping Linux `node-pty` prebuilds upstream or switching PTY libraries.
- Changing the user-facing "could not be started" text.

## Decisions

**Floor: glibc 2.31.** This is Debian 11 and Ubuntu 20.04. Electron 42's own
binary needs `GLIBC_2.25`, and Electron documents Debian 10 / Ubuntu 18.04 as its
Linux baseline. The Node 24 binary in the server archive needs 2.28. Nothing in
the stack needs 2.36, and 2.31 brings in Ubuntu 22.04 (2.35), which is still a
common LTS. Going lower than 2.31 would need a Node 24 build image older than the
official ones. The C++ floor is the one in the same image: `GLIBCXX_3.4.28` and
`CXXABI_1.3.12` (GCC 10).

Alternatives considered:

- Pin `runs-on: ubuntu-22.04`. Runner images are retired on GitHub's schedule,
  so this postpones the problem. It also does not cover the Gitea fleet.
- Cross-compile with `zig cc -target x86_64-linux-gnu.2.31`. This works for one
  addon, but electron-builder and npm would still run node-gyp with the host
  toolchain, and every native dependency would need its own wiring.

**One floor image, `node:24.15.0-bullseye`, pinned by digest, for every Linux
build.** The image has Node 24.15.0 (ADR-0033's pinned runtime), glibc 2.31, GCC
10, Python and git. `Dockerfile.linux-floor` installs dependencies with `npm ci`
in it, then copies the source. `scripts/run-in-linux-floor.sh` builds that image
from the repository as context, runs the given command in it, and copies the
named outputs back with `docker cp`. This is the same pattern as
`run-e2e-container.sh`. The workspace is never bind-mounted, because Gitea jobs
reach a Docker daemon that cannot see their filesystem
(`e2e-container-contract.test.mjs` already forbids it). Inputs that live
outside the repository, such as the beta release notes, are copied in with
`--input`. Everything that compiles, packages, or stages runs inside the image,
including electron-builder's rebuild. The whole job is not moved into the
image: signing, checksums, `gh` uploads, and the host-side verification steps
stay on the runner, where their credentials and tools are.

The standalone archive steps that every lane repeated inline (build the app,
verify built-ins, stage WebRTC, fetch the pinned Node archive, build the
archive) move into `scripts/build-linux-standalone-archive.sh`. Release, main,
and pull-request CI then run the same command in the floor image. The beta
Desktop build moves into `scripts/build-main-beta-desktop.sh`, so macOS runs it
on its runner and Linux runs the same script in the floor image.

The floor runtime image installs Electron's libraries from the Debian snapshot
its base image names, not from the live bullseye mirrors. Those mirrors are
past end of life, and their indexes list security updates whose files are
gone.

**Static check: ELF symbol-version requirements, read without binutils.**
`scripts/linux-glibc-floor.mjs` walks a directory, an extracted AppImage, or an
extracted `.tar.gz`. It reads each regular ELF file's `SHT_GNU_verneed` section
(32- and 64-bit, either byte order) and fails on any `GLIBC_`, `GLIBCXX_`, or
`CXXABI_` version above the floor. Files for another machine are counted and
skipped. The packaged `koffi` carries armhf, ia32, riscv64 and loong64 builds
that are never loaded on x64, and some of them need 2.34–2.36. `GLIBC_PRIVATE`
and other version names are ignored. The floor and the two image references
live in this one module. The Dockerfiles must name the same digests, and a
contract test enforces that.

**Runtime probe: the real artifact, on a clean floor host.**
`Dockerfile.linux-floor-runtime` is `debian:bullseye-slim`, pinned by digest,
plus only the shared libraries Electron links. It has no Node, no compiler and
no npm. `scripts/probe-linux-glibc-floor.sh` copies an AppImage or server
archive into it and extracts it. For the AppImage the AppImage runtime does the
extraction, which also proves that runtime starts there. The script requires
`ldd` to resolve every library of the entry binary. It then runs
`scripts/linux-glibc-floor-probe.mjs` under the artifact's own runtime: Electron
in Node mode, or the archive's `bin/node`. That probe first launches
`sessionHolderEntry.js` exactly as the server does, waits for the readiness
descriptor to close, and requires the holder record. This is the path that
failed for users, and when it fails the holder's own report names the cause.
The probe then loads `node-pty` from the holder entry's location, runs
`/bin/sh` in a PTY, and checks its output and exit status.

**Where the gates run.** A new Gitea pull-request job, `linux-glibc-floor`,
builds the AppImage and the x64 archive at the floor, then runs the check and
the probe on both. The release and main lanes run the same check and probe on
the bytes they are about to checksum, sign or upload: the AppImage, and both
archives (arm64 on its native runner). Static checks run on the host. Runtime
probes need Docker, which every one of these runners has.

**Holder start-up failures are reported over the readiness descriptor.**
`sessionHolderEntry.ts` imported `node-pty` statically, so a load failure threw
before any of the holder's code ran, onto a discarded stderr. The entry now
imports it dynamically before anything else, so the holder still loads
everything it will run before it holds a session (ADR-0035 §2). On failure it
asks `describeNativeModuleLoadFailure` for the reason. node-pty's own error names
only its last attempt, a prebuild that does not exist on Linux, so that helper
loads the addon files that do exist and reports their loader error. The entry
writes the reason, bounded, to the readiness descriptor and exits 1. A holder
that fails after loading writes its error the same way. The launcher keeps up to
2 KiB of what arrives on that descriptor. If the holder exits before it is
ready, the launcher waits for the descriptor to close and appends that text to
the launch error. The launch-failed observation and diagnostic carry it from
there unchanged, and diagnostic sanitising still applies. The descriptor exists
only between a launcher and the holder it just started from the same build, so
this is not a change to the frozen holder protocol.

Boundaries: none of the trust boundaries move. The holder protocol, its socket,
and its credential are unchanged, and no renderer, extension, or remote path is
involved. The release boundary tightens: the Linux lanes now publish nothing
that has not passed the floor check and the probe.

## Risks / Trade-offs

- [Debian 11's regular security support has ended] → The image is a build
  environment, not shipped userspace. The compiler and headers are what matter,
  and the outputs are checked. When a newer Node release drops bullseye images,
  ADR-0077 is revisited with the floor and the image changed together.
- [Builds get slower, because dependencies install in Docker without the npm
  cache] → The dependency layer is keyed by the manifests and reused on a warm
  Docker host. Release lanes run rarely.
- [Electron raises its own floor above 2.31] → The static check reports it on
  the first build that ships it. The floor is then raised deliberately in a
  change, never by a runner.
- [The probe covers Electron's Node mode, not a full GUI launch on bullseye] →
  The failing path and every native library were in Node mode. The GUI path's
  libraries are covered by the `ldd` check and the static scan. A packaged GUI
  launch stays covered by the existing packaged suites on the runner.
