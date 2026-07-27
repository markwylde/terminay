# PTY runtime distribution evidence

This record narrows the PTY portion of
[the server architecture decision spikes](../tasks_completed/3-server-architecture-decision-spikes.md).
It does not establish that the complete standalone server is distributable.

## Selected slice

- The server keeps `node-pty` 1.1.0 and supervises one host child per PTY.
- Linux PTY runtime archives contain Node 22.23.1, the built PTY host module
  graph, node-pty's JavaScript runtime, and one target-native `pty.node`.
- CI assigns Linux x64 and arm64 artifact assembly/execution to matching native
  runners. Local evidence is native arm64 plus architecture-emulated x64; the
  native CI lanes remain release evidence.
- Native compilation happens only on the trusted producer runner. Extracted
  artifacts contain no node-gyp input, compiler, npm, or source tree and start
  with the bundled Node runtime.
- The archive is a deterministic `tar.gz` with normalized ownership, modes,
  order, timestamps, and gzip metadata. CI builds it twice and requires equal
  SHA-256 values.
- This PTY payload is an input to the complete `terminay-server` distribution;
  it is not presented as the final server executable.

## Pinned runtime inputs

| Target | Node archive SHA-256 | ELF machine |
| --- | --- | --- |
| `linux-x64` | `9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578` | 62 |
| `linux-arm64` | `0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1` | 183 |

The builder rejects an incorrect Node checksum, node-pty version, runner
architecture, or ELF machine before writing an artifact.

Linux manifests explicitly record that no `spawn-helper` is required or
present. node-pty uses its `forkpty` native branch on Linux; its binding defines
and builds `spawn-helper` only on macOS. The packaged macOS arm64 proof copies,
hashes, marks executable, and exercises that helper.

## Executable coverage

The macOS development probe runs the same built host under plain Node and
Electron Node mode. A separate supervisor fixture launches Electron normally,
waits for `app.whenReady()` in a real `browser` main process, and has that main
process call `child_process.fork` exactly as the application does. The forked
Electron Helper runs the same built `dist-electron/ptyHost.js` with
`ELECTRON_RUN_AS_NODE=1`.

Together the development probes verify readiness, IPC, cwd, UTF-8, interactive
input, resize, inactivity, normal exit status, SIGTERM metadata without
rewriting the native exit code, foreground inspection, descendant cleanup, and
bounded kill. The real-main fixture proves that the supervisor is not merely a
Node test process invoking the Electron binary in Node mode.

The native Linux archive probe additionally verifies:

- the extracted manifest's file sizes, modes, and hashes;
- execution through the pinned Node binary in the archive;
- foreground-process inspection through `generic:foreground` activity;
- independent preservation of node-pty exit code and numeric signal metadata;
- removal of a PTY shell and its background child; and
- bounded host shutdown.

### Clean Linux container evidence

The 2026-07-27 local artifact run uses a Linux arm64 Podman VM on an Apple
Silicon host. Its producer containers contain the compiler and build
node-pty 1.1.0. Separate `debian:bookworm-slim` target containers contain no
system Node, npm, node-gyp, Python, compiler, or make. They install only the
packages used by the recorded container harness, extract the archive, and use
the archive's pinned Node binary to execute the probe. The PTY payload itself
does not declare or invoke `procps`.

| Target | Execution qualification | Repeated archive SHA-256 | Result |
| --- | --- | --- | --- |
| `linux-arm64` | Native arm64 VM and container (`uname -m`: `aarch64`, `process.arch`: `arm64`) | `a8dceb75ce1bca78c5833b602b847499412a91d42afb4e82a952662e2bce1fc9` | Pass |
| `linux-x64` | x64 container under binfmt/QEMU emulation on the arm64 VM (`uname -m`: `x86_64`, `process.arch`: `x64`) | `dd848960b7584cf09e9fc6b4ac59e381a88ba5bf26897b64c019b6ce4c371c4b` | Pass |

Each target is assembled twice from the same native addon and both archive
hashes are byte-for-byte equal. Each archive has 57 entries and contains no
node-gyp input, compiler, npm, node-pty source tree, `binding.gyp`, C/C++
source, or header files. The builder checks the target ELF machine before
assembly, and successful create/IO/resize/process/signal probes demonstrate
that the target-native addon loads through the bundled Node ABI.

Both clean target runs prove:

- cwd `/tmp`, UTF-8 `✓-雪`, interactive input, and a `41 x 103` resize;
- foreground-process detection through `generic:foreground`;
- normal exit code `9` with no signal and SIGTERM as exit code `0` plus
  numeric signal `15`;
- removal of the PTY root and background descendant; and
- bounded shutdown (2 ms in the native arm64 run and 19 ms in the emulated
  x64 run).

This is native local evidence for arm64 and architecture-emulated evidence for
x64. It does not claim native x64 host execution. The GitHub Actions matrix
assigns `linux-x64` to `ubuntu-24.04` and `linux-arm64` to
`ubuntu-24.04-arm`; successful CI runs on both native runners remain the
release evidence. A local macOS process alone proves neither Linux artifact.

### Packaged macOS Desktop evidence

The 2026-07-27 packaged proof builds an arm64 application directory with
Electron 42.7.1 and `CSC_IDENTITY_AUTO_DISCOVERY=false`, then launches the
actual `Terminay.app/Contents/MacOS/Terminay` binary through Playwright from an
isolated cwd containing a poisoned host `node-pty`. Loader and development
environment overrides are removed. The running application reports
`process.type: browser`, `process.arch: arm64`, the exact packaged
`process.resourcesPath`, and no `ELECTRON_RUN_AS_NODE` in its main process.
Electron's macOS 12 removal notice says Monterey support ends in Electron 44;
the supported Electron 42.7.1 floor is therefore macOS 12 Monterey.

The package contains:

- the built PTY host in
  `app.asar.unpacked/dist-electron/ptyHost.js`;
- an arm64 `pty.node` at
  `app.asar.unpacked/node_modules/node-pty/build/Release/pty.node`, mode
  `0755`, SHA-256
  `7052df1427fd73a4d0ac7083ff01f2b5900c02c6641bbd2ccd860cbd7f1641dd`;
  and
- an arm64 `spawn-helper` beside the addon, mode `0755`, SHA-256
  `b510bf015ec3d5a209d0926f376881049b58eeba08acb2328ac10fecce047b72`.

The proof reads node-pty's packaged `unixTerminal.js` from `app.asar` and
checks that it maps the selected addon directory from `app.asar` to
`app.asar.unpacked` before passing `spawn-helper` to `pty.fork`. The actual
main process then forks:

```text
Terminay Helper .../Contents/Resources/app.asar/dist-electron/ptyHost.js
```

Successful PTY creation demonstrates that Electron's logical asar entry,
unpacked arm64 addon, and unpacked executable helper resolve together. The
recorded `posix_spawnp failed` error does not reproduce with this current
package.

The actual packaged main-process run proves:

- cwd `/tmp`, UTF-8 `✓-雪`, interactive IO, and a `33 x 99` resize;
- inactivity after at least 180 ms of quiet and foreground detection through
  `generic:foreground`;
- normal exit code `17` with no signal and SIGTERM as exit code `0` plus
  numeric signal `15`;
- removal of each Electron Helper PTY host after exit; and
- removal of a background descendant with bounded shutdown (27 ms in the
  recorded run).

This is an unsigned local runtime candidate. electron-builder explicitly skips
application signing, `codesign --verify --deep --strict` fails, and the
linker-signed outer executable has no team identifier. It does not prove
Developer ID signing, hardened-runtime entitlements after signing,
notarization, stapling, Gatekeeper installation, auto-update, or a distributable
DMG. Those remain release gates rather than reasons to reject the runtime
layout.

### Packaged GNU/Linux Desktop candidate

`scripts/pty-packaged-linux.test.mjs` accepts the supported x64 AppImage,
extracts its SquashFS payload without mounting it, validates the x86-64
`pty.node`, and launches the packaged Electron browser main process under
Xvfb. The proof removes host loader/development overrides, uses an isolated cwd
containing a poisoned `node-pty`, requires `process.resourcesPath` to remain
inside the extracted AppImage, and requires the exact packaged `ptyHost.js`
child path. It applies the same packaged behavior contract for cwd, UTF-8,
interactive input, resize, inactivity, foreground-process inspection,
exit/signal fidelity, PTY-host removal, descendant cleanup, and bounded
shutdown.

The native x64 CI lane builds and exercises this candidate in a
`node:22.23.1-bookworm-slim` environment, verifies glibc 2.36, and removes the
compiler toolchain before the runtime probe. This makes the target phase
compiler-free; it does not remove the container's harness Node/npm. The probe
nevertheless forks the PTY host with the distribution's bundled Node. The
separate clean-target runs above establish operation with no system Node or
npm. A successful native lane establishes the Debian 12/glibc 2.36 userspace
floor even though its host kernel comes from Ubuntu; older kernels and other
distro combinations remain release variation. That configured lane is not
recorded as passing evidence until a workflow run succeeds. A local
architecture-emulated x64 attempt on the arm64 Podman VM installed the
Debian 12 build and Electron runtime dependencies, then QEMU terminated with
signal 11 during the TypeScript build before an AppImage existed. It provides
no packaged-runtime result.

## Unsupported or incomplete evidence

- node-pty 1.1.0 publishes macOS and Windows prebuilds but no Linux prebuild.
  Linux native files therefore come from the native producer runner; installing
  the npm package on the target machine is not an accepted distribution path.
- Linux glibc compatibility depends on the producer environment. Native
  execution on Ubuntu 24.04 proves those CI machines only; it does not establish
  the oldest supported distribution.
- The local x64 container proof is architecture-emulated. A successful native
  `ubuntu-24.04` x64 CI lane remains required before release.
- Alpine/musl has no artifact or execution evidence and is unsupported by this
  slice.
- The configured packaged GNU/Linux x64 probe has no successful native run.
- macOS x64, signed/notarized macOS releases, Windows, provider CLIs, the MCP
  entry, hook scripts, the responsive UI, and the final `./terminay-server`
  launcher remain outside the proven package slice.

## Commands

The development proof is:

```sh
npm run test:pty-host-runtime
```

The unsigned arm64 packaged proof is:

```sh
npm run test:pty-packaged-macos
```

The Linux native CI path builds with:

```sh
node scripts/build-pty-runtime-artifact.mjs \
  --target linux-x64 \
  --node-archive /path/to/node-v22.23.1-linux-x64.tar.xz \
  --output-dir /tmp/pty-artifact
```

and probes the extracted payload with:

```sh
node scripts/pty-runtime-artifact-probe.mjs \
  --target linux-x64 \
  --archive /tmp/pty-artifact/terminay-pty-runtime-node22.23.1-linux-x64.tar.gz
```
