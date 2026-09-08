# ADR-0016: Distribute the standalone server as signed self-contained per-architecture archives on tag and rolling `main` channels

Status: accepted
Date: 2026-09-07

## Context

ADR-0001 requires platform artifacts to carry their own pinned Node runtime,
and ADR-0004 fixes the supported Linux matrix around a prebuilt `node-pty`.
The release pipeline nevertheless attached an `npm pack` of the private
server workspace, whose dependencies are not published, so no release asset
could be installed on a machine that had not cloned the repository. A
command-line installer that must fetch a specific version, verify it, and
upgrade or roll back in place needs a stable, verifiable unit of distribution
and a way to name pre-release builds.

## Decision

1. The unit of standalone distribution is
   `terminay-server-<version>-linux-<arch>.tar.gz` for `x64` and `arm64`,
   built by the deterministic archive builder: pinned Node binary, compiled
   server and workspace packages, production dependency closure with the
   native `pty.node`, matching UI bundle, selected WebRTC runtime, wrapper
   entrypoints, and `artifact-manifest.json`. No system Node, npm, or
   compiler is needed on the target.
2. Every archive is accompanied by a SHA-256 sidecar and an Ed25519
   signature over the archive bytes made with the release signing key.
   Installers verify both before unpacking; the public key is embedded in
   the installer and rotates only through an installer release.
3. The manifest records `channel` (`tag` or `main`), `revision` (the built
   commit), `version`, and `architecture`. Tagged releases form the stable
   channel. A single prerelease named `main` is rebuilt on every merge to
   `main` and its assets are replaced as a complete set.
4. Installers lay versions out side by side under a versioned directory with
   an atomically switched `current` pointer, keep the previous version for
   rollback, and never touch the data root during an upgrade. On the `main`
   channel, `revision` decides whether an upgrade is available.

## Consequences

- The `npm pack` tgz is no longer a release asset; nothing consumed it.
- Two native build jobs per release and per merge to `main`, and an arm64
  runner or a proven cross-staging path for that architecture.
- Refs without a prebuilt archive (a branch other than `main`, a bare commit)
  can only be installed by building from source on the target; installers
  may offer that as a slower, toolchain-dependent fallback.
- The signing public key becomes a compatibility surface of the installer.
