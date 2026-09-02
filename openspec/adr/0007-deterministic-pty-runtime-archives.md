# ADR-0007: Build PTY runtime archives deterministically on a trusted producer runner

Status: accepted
Date: 2026-07-27

## Context

[ADR-0004](./0004-node-pty-and-supported-distribution-matrix.md) selects
`node-pty` and declares the supported distribution matrix. It does not say how
the native payload reaches a target machine.

`node-pty` 1.1.0 publishes macOS and Windows prebuilds but no Linux prebuild, so
installing the npm package on the target is not a viable distribution path for
the supported Linux targets: it would require a compiler, node-gyp, Python, and
network access on every user machine, and it would make the shipped binary
depend on whatever toolchain that machine happens to have.

At the time of this record the PTY host was an Electron `ptyHost` child
supervised by the Desktop main process, and the runtime target was Node 22.23.1.

## Decision

The server keeps `node-pty` 1.1.0 and supervises one host child per PTY.

Linux PTY runtime archives contain the pinned Node runtime, the built PTY host
module graph, node-pty's JavaScript runtime, and one target-native `pty.node`.

Native compilation happens only on the trusted producer runner. Extracted
artifacts contain no node-gyp input, compiler, npm, or source tree, and start
with the bundled Node runtime.

The archive is a deterministic `tar.gz` with normalized ownership, modes, order,
timestamps, and gzip metadata. CI builds it twice and requires equal SHA-256
values. The builder rejects an incorrect Node checksum, node-pty version, runner
architecture, or ELF machine before writing an artifact.

CI assigns Linux x64 and arm64 artifact assembly and execution to matching
native runners (`ubuntu-24.04` and `ubuntu-24.04-arm`). Local evidence is native
arm64 plus architecture-emulated x64; the native CI lanes remain release
evidence.

This PTY payload is an input to the complete `terminay-server` distribution; it
is not the final server executable.

### Pinned runtime inputs

| Target | Node archive SHA-256 | ELF machine |
| --- | --- | --- |
| `linux-x64` | `9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578` | 62 |
| `linux-arm64` | `0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1` | 183 |

Linux manifests explicitly record that no `spawn-helper` is required or present:
node-pty uses its `forkpty` native branch on Linux and defines and builds
`spawn-helper` only on macOS. The packaged macOS arm64 proof copies, hashes,
marks executable, and exercises that helper.

## Consequences

- Target machines need no compiler, no system Node, and no npm.
- Adding a supported architecture means adding a matching native producer
  runner, not a build flag.
- Reproducibility is enforced rather than assumed: two builds of the same input
  must hash identically or CI fails.

### Evidence

The macOS development probe runs the built host under plain Node and Electron
Node mode. A separate supervisor fixture launches Electron normally, waits for
`app.whenReady()` in a real `browser` main process, and has that main process
call `child_process.fork` exactly as the application does, running the same
built `dist-electron/ptyHost.js` with `ELECTRON_RUN_AS_NODE=1`. Together the
development probes verify readiness, IPC, cwd, UTF-8, interactive input, resize,
inactivity, normal exit status, SIGTERM metadata without rewriting the native
exit code, foreground inspection, descendant cleanup, and bounded kill. The
real-main fixture proves the supervisor is not merely a Node test process
invoking the Electron binary in Node mode.

The native Linux archive probe additionally verifies the extracted manifest's
file sizes, modes, and hashes; execution through the pinned Node binary in the
archive; foreground-process inspection through `generic:foreground`; independent
preservation of node-pty exit code and numeric signal metadata; removal of a PTY
shell and its background child; and bounded host shutdown.

**Clean Linux container run, 2026-07-27.** A Linux arm64 Podman VM on an Apple
Silicon host. Producer containers contain the compiler and build node-pty 1.1.0.
Separate `debian:bookworm-slim` target containers contain no system Node, npm,
node-gyp, Python, compiler, or make; they extract the archive and use the
archive's pinned Node binary to execute the probe. The PTY payload itself does
not declare or invoke `procps`.

| Target | Execution qualification | Repeated archive SHA-256 | Result |
| --- | --- | --- | --- |
| `linux-arm64` | Native arm64 VM and container (`uname -m`: `aarch64`, `process.arch`: `arm64`) | `a8dceb75ce1bca78c5833b602b847499412a91d42afb4e82a952662e2bce1fc9` | Pass |
| `linux-x64` | x64 container under binfmt/QEMU emulation on the arm64 VM (`uname -m`: `x86_64`, `process.arch`: `x64`) | `dd848960b7584cf09e9fc6b4ac59e381a88ba5bf26897b64c019b6ce4c371c4b` | Pass |

Each target is assembled twice from the same native addon and both archive
hashes are byte-for-byte equal. Each archive has 57 entries and contains no
node-gyp input, compiler, npm, node-pty source tree, `binding.gyp`, C/C++
source, or header files. Both clean target runs prove cwd `/tmp`, UTF-8 `✓-雪`,
interactive input and a `41 x 103` resize; foreground-process detection through
`generic:foreground`; normal exit code `9` with no signal and SIGTERM as exit
code `0` plus numeric signal `15`; removal of the PTY root and background
descendant; and bounded shutdown (2 ms native arm64, 19 ms emulated x64).

**Packaged macOS Desktop run, 2026-07-27.** An arm64 application directory built
with Electron 42.7.1 and `CSC_IDENTITY_AUTO_DISCOVERY=false`, launched as the
actual `Terminay.app/Contents/MacOS/Terminay` binary through Playwright from an
isolated cwd containing a poisoned host `node-pty`, with loader and development
environment overrides removed. The running application reports
`process.type: browser`, `process.arch: arm64`, the exact packaged
`process.resourcesPath`, and no `ELECTRON_RUN_AS_NODE` in its main process. The
package contains the built PTY host at `app.asar.unpacked/dist-electron/ptyHost.js`;
an arm64 `pty.node` at
`app.asar.unpacked/node_modules/node-pty/build/Release/pty.node`, mode `0755`,
SHA-256 `7052df1427fd73a4d0ac7083ff01f2b5900c02c6641bbd2ccd860cbd7f1641dd`; and an
arm64 `spawn-helper` beside the addon, mode `0755`, SHA-256
`b510bf015ec3d5a209d0926f376881049b58eeba08acb2328ac10fecce047b72`. The proof
reads node-pty's packaged `unixTerminal.js` from `app.asar` and checks that it
maps the selected addon directory from `app.asar` to `app.asar.unpacked` before
passing `spawn-helper` to `pty.fork`. Successful PTY creation demonstrates that
Electron's logical asar entry, unpacked arm64 addon, and unpacked executable
helper resolve together; the previously recorded `posix_spawnp failed` error does
not reproduce. The run proves cwd `/tmp`, UTF-8 `✓-雪`, interactive IO, a
`33 x 99` resize; inactivity after at least 180 ms of quiet and foreground
detection through `generic:foreground`; normal exit code `17` with no signal and
SIGTERM as exit code `0` plus numeric signal `15`; removal of each Electron
Helper PTY host after exit; and removal of a background descendant with bounded
shutdown (27 ms).

**Packaged GNU/Linux Desktop candidate.** `scripts/pty-packaged-linux.test.mjs`
accepts the supported x64 AppImage, extracts its SquashFS payload without
mounting it, validates the x86-64 `pty.node`, and launches the packaged Electron
browser main process under Xvfb, applying the same packaged behaviour contract.
The native x64 CI lane builds and exercises this candidate in a
`node:22.23.1-bookworm-slim` environment, verifies glibc 2.36, and removes the
compiler toolchain before the runtime probe. A successful native lane establishes
the Debian 12 / glibc 2.36 userspace floor even though its host kernel comes from
Ubuntu.

## Open items

Unsupported or incomplete at the time of this record:

- Installing the npm `node-pty` package on a Linux target is not an accepted
  distribution path; Linux native files come only from the native producer
  runner.
- Linux glibc compatibility depends on the producer environment. Native
  execution on Ubuntu 24.04 proves those CI machines only; it does not establish
  the oldest supported distribution.
- The local x64 container proof is architecture-emulated. A successful native
  `ubuntu-24.04` x64 CI lane remains required before release.
- Alpine/musl has no artifact or execution evidence and is unsupported.
- The configured packaged GNU/Linux x64 probe has no successful native run. A
  local architecture-emulated attempt on the arm64 Podman VM ended when QEMU
  terminated with signal 11 during the TypeScript build, before an AppImage
  existed.
- The packaged macOS proof is an unsigned local runtime candidate.
  electron-builder skips application signing, `codesign --verify --deep --strict`
  fails, and the linker-signed outer executable has no team identifier. Developer
  ID signing, hardened-runtime entitlements after signing, notarization,
  stapling, Gatekeeper installation, auto-update, and a distributable DMG remain
  release gates.
- macOS x64, Windows, provider CLIs, the MCP entry, hook scripts, the responsive
  UI, and the final `./terminay-server` launcher are outside the proven package
  slice.

The runtime target recorded here is Node 22.23.1. Active builds pin Node 24.15.0
under [ADR-0001](./0001-pinned-node-runtime-baseline.md); the Node 22 results
above remain the historical evidence for this distribution decision, and CI and
release lanes requalify the active Node 24 artifacts rather than rewriting them.
