# ADR-0077: Linux artifacts are built and verified at a declared glibc floor

Status: accepted, supersedes ADR-0035
Date: 2026-10-30
Supersedes: ADR-0035

## Context

ADR-0035 moved PTYs into a detached session holder and restated ADR-0004's
distribution matrix, including "Debian 12-compatible hosts with glibc 2.36 or
newer". Neither ADR said how a Linux artifact comes to meet that floor.
ADR-0007 recorded the gap as an open item: "Linux glibc compatibility depends on
the producer environment."

That gap shipped. Terminay 6.3.0's AppImage was built on a GitHub
`ubuntu-latest` runner with glibc 2.42. Its `pty.node` binds
`cfsetispeed@GLIBC_2.42` and `cfsetospeed@GLIBC_2.42`, so on Ubuntu 24.04
(glibc 2.39), and on the Debian 12 hosts the matrix names, the session holder
exits as it loads `node-pty` and no terminal can start. glibc is only backward
compatible: a binary runs on the glibc it was linked against and on newer ones,
never on older ones. A floor stated in a spec means nothing unless the build
fixes it and a check proves it.

Electron 42's own binary needs `GLIBC_2.25`, and the pinned Node 24 binary
needs 2.28. The 2.36 floor came from the original Debian 12 evidence
environment, not from anything the stack requires.

ADR-0035's holder topology is not being revisited. Only its decision 6 changes,
and the rest is restated here unchanged.

## Decision

1. **PTYs are owned by a detached session holder, not by the server.**
   Unchanged from ADR-0035 §1.

2. **One holder serves all sessions of one data root, per generation.**
   Unchanged from ADR-0035 §2.

3. **The holder protocol is internal, versioned, and local.** Unchanged from
   ADR-0035 §3.

4. **A holder never runs unbounded.** Unchanged from ADR-0035 §4.

5. **Terminal output reaches disk only as a bounded tail of a session that
   ended unattached.** Unchanged from ADR-0035 §5.

6. **The distribution matrix has a glibc 2.31 floor for every GNU/Linux
   target.** Desktop: macOS 12 or newer on arm64, and GNU/Linux x64. Standalone
   Server: GNU/Linux x64 and arm64. Every GNU/Linux target needs glibc 2.31 or
   newer (Debian 11, Ubuntu 20.04, and anything newer). The C++ runtime floor
   is `GLIBCXX_3.4.28` and `CXXABI_1.3.12`. macOS x64, Linux arm64 Desktop,
   Windows, standalone macOS/Windows Server, and Alpine/musl Linux are outside
   the matrix. There is one PTY implementation, shared by Desktop and
   standalone, and every supported target needs its own native `node-pty` build
   from the release pipeline.

7. **The floor is a build input, not a runner property.** Every Linux artifact
   is compiled, packaged, and staged inside one floor build image,
   `node:24.15.0-bullseye`, pinned by digest. Each job's runner only hosts
   Docker. The floor, the build image, and the runtime image are declared once,
   in `scripts/linux-glibc-floor.mjs`, and the Dockerfiles must agree with it.

8. **No Linux artifact merges or publishes without proof that it meets the
   floor.** A static check reads the `GLIBC_`, `GLIBCXX_`, and `CXXABI_`
   requirements of every ELF file of the artifact's architecture and fails
   above the floor. A runtime probe extracts the artifact in a clean
   `debian:bullseye-slim` environment, pinned by digest, with no compiler and no
   Node. Using the artifact's own runtime, it runs a shell through `node-pty` and
   starts the session holder until it is ready. Pull-request CI runs both on
   x64. Release and main lanes run both on the exact bytes they publish, on
   every architecture.

## Consequences

- Ubuntu 22.04 LTS and Debian 11 hosts become supported, and Ubuntu 24.04 and
  Debian 12 stop depending on which runner image happened to build a release.
- Raising the floor is a deliberate decision. When a dependency, Electron, or
  Node needs more, the static check fails, and the floor and image move
  together in a change that supersedes this record.
- The floor image's distribution is past regular security support. It is a
  build environment and never shipped userspace. The image is replaced, through
  a superseding record, when no pinned Node release is published for it.
- Linux builds now run in Docker and pay for a dependency install in the image.
  The dependency layer is reused when the manifests are unchanged.
- ADR-0007's open item on producer-environment glibc is closed.

## Open items

- ADR-0035's open items carry over unchanged: the holder survival spike (bundle
  replacement, AppImage unmount, `versions/` removal, macOS privacy) and the
  per-architecture release-gate probe gaining reattach after server exit.
