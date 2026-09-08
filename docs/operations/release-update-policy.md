# Release install and update policy

This policy applies to the matched Terminay Desktop/server release topology.
It is the local recovery contract behind [Task 20](../tasks_completed/20-security-release-and-operations.md)
and complements the [standalone server runbook](./standalone-server.md).

## The published install and upgrade unit

A standalone server is installed and upgraded from one self-contained archive
per Linux architecture. Nothing else on a GitHub release is an install unit;
in particular there is no longer an `npm pack` tarball, which was never
installable because the server's workspace dependencies are private.

Each archive ships as three files:

| File | Purpose |
| --- | --- |
| `terminay-server-<version>-linux-<arch>.tar.gz` | The archive: pinned Node runtime, compiled server and workspace packages, the production dependency closure including the native `node-pty`, the matched UI bundle, the selected WebRTC runtime, and `artifact-manifest.json` |
| `<archive>.sha256` | SHA-256 sidecar over the archive bytes, verified from the archive's own directory |
| `<archive>.sig` | Detached Ed25519 signature over the archive bytes, made with the release signing key |

Supported architectures are `linux-x64` and `linux-arm64` (see
[ADR-0004](../../openspec/adr/0004-node-pty-and-supported-distribution-matrix.md)).
The archive carries its own Node runtime, so a target needs neither Node nor a
compiler.

## Release channels

Two channels publish the same three files per architecture:

- **`tag`** — a tagged release. Assets are named for the version and are
  immutable: a published name is never replaced.
- **`main`** — a rolling prerelease tagged `main-latest`, rebuilt on every
  merge to the default branch, whose assets keep the stable names
  `terminay-server-main-linux-<arch>.tar.gz`. Replacement uploads land under
  temporary names first and only then take the published names, so a reader
  sees either the previous complete set or the new one.

The rolling tag is deliberately not named for the branch: a release tagged
`main` would make `main` an ambiguous ref in every clone, so `git fetch main`
would resolve the tag rather than the branch.

Every archive's `artifact-manifest.json` records its `channel`, the built
`revision` (commit), its `architecture`, and its `version`, and the installed
launcher reports that same version. On the rolling channel an installer
compares `revision`, not `version`, to decide whether the channel moved.
Verification rejects a manifest missing any of the three, and rejects an
archive whose launcher and manifest disagree about the version.

## Independent update targets

- `desktop-host` updates Terminay Desktop and its embedded, matched server/UI
  payload. It may restart the embedded local server as part of that host
  update.
- `standalone-server` updates only the explicitly selected local standalone
  installation and its matched UI/protocol payload.
- A remote server is never an implicit update target. Desktop and browser
  clients may report that a remote server is incompatible, but only an
  explicit operator action on that server may install its artifact.

An update carries product, artifact, server, UI, and protocol versions. The
host validates those fields and the artifact manifest before activation. A
candidate with an incompatible protocol or matched UI/server version is
rejected while the current artifact remains active.

## Install, upgrade, and rollback

1. Verify the `.sha256` sidecar and the `.sig` detached signature against the
   release signing key, then the manifest's channel, revision, architecture,
   target platform, and version output, before staging it. Fetch the manifest
   last and re-verify the bytes that were actually fetched.
2. Stop the foreground standalone process or let the Desktop supervisor own
   the embedded restart. Do not run two authorities against one data root.
3. Stage the candidate in a new versioned directory and atomically move the
   active pointer only after validation succeeds.
4. Preserve the same data root and stable server identity across an upgrade.
5. Keep the previous artifact and a complete data-root backup until the new
   version passes readiness and smoke checks.
6. Roll back by restoring the previous artifact and a validated backup/root;
   never overwrite the only failed root.

The deterministic local lifecycle harness is
`scripts/task20-release-lifecycle.mjs` with coverage in
`scripts/task20-release-lifecycle.test.mjs`. It proves state-transition and
boundary behavior only; it does not claim that macOS notarization, Linux
package installation, or platform-specific signed-artifact execution has run.

## Failure recovery

An incompatible candidate, failed readiness check, or interrupted activation
must leave the prior artifact selected and the data root/identity unchanged.
Operators preserve the failed artifact and logs for diagnosis, then retry or
roll back from the validated copy. A server-process crash is a recovery event,
not permission to create a second server authority.
