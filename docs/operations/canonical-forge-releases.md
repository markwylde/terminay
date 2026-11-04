# Desktop releases on the canonical forge

`git.i.wylde.net/markwylde/terminay` builds its own macOS arm64 and Linux x64
desktop releases through **Actions → Trigger Release**. It does not download
GitHub binaries. GitHub continues its existing macOS, Linux, and Windows releases.
Applications from both forges continue to use the GitHub update feed.

## Runners and credentials

- `macos`: native Apple Silicon macOS runner with Xcode command-line tools,
  writable Node tool cache for `actions/setup-node`, and a usable signing keychain.
  The workflow imports the Developer ID certificate and requires notarization.
- `ubuntu-latest`: native Linux x64 runner with Docker access for the project's
  glibc-floor image and terminal probes. Container paths and permissions must
  support `scripts/run-in-linux-floor.sh`.
- Node 24.15.0 is installed by setup-node; npm 12.2.1 is installed under
  `$HOME/.local` so the runner does not require a globally writable npm prefix.
- Repository secrets: `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`,
  `APPLE_APP_SPECIFIC_PASSWORD`.
- Repository variables: `APPLE_ID`, `APPLE_TEAM_ID`.
- The forge-provided workflow token needs repository tag/release write access.
  No GitHub token, Windows runner, or separate artifact service is required.

The secret names and both Apple variables were confirmed present on the canonical
forge on 2026-11-04. Their validity still needs a real signed build.

## Dispatch

Once the workflow is on `main`, select **Trigger Release → Run workflow**, choose
`main`, and supply `tag` as a stable semantic version such as `v1.2.3`.
Choose the intended version explicitly: this workflow does not automatically bump
versions or coordinate version selection with GitHub. It rejects dispatches on
other branches. It creates the tag at the selected main commit if absent; an
existing tag must identify that exact commit. Tags can propagate through the
repository's existing mirroring, so select versions with that shared namespace
in mind. No GitHub release is created or changed by this workflow.

The release stays a draft while both platform builds run. Published assets are:

- `Terminay-Mac-VERSION-Installer.dmg`
- `Terminay-Mac-VERSION.zip`
- `Terminay-Mac-VERSION.zip.blockmap`
- `Terminay-Linux-VERSION.AppImage`
- A `.sha256` sidecar for each of those files.

The macOS lane verifies signing, notarization, microphone entitlements, DMG startup,
and the update ZIP. Linux verifies the glibc floor and terminal execution. Generated
update metadata is checked locally; the forge is not a separate application update
feed. After both jobs pass, the publisher downloads all eight attachments, verifies
their checksums and exact inventory, and publishes the draft with the source SHA.

## Failed runs and retries

Inspect the failed job and repair the runner or credentials. Re-run the original
workflow run to preserve its source SHA. A fresh dispatch after `main` advances
cannot reuse the old tag. Existing identical draft attachments are reused;
different bytes under the same filename are rejected rather than overwritten.
Signed/notarized rebuilds can produce different bytes, so partial drafts may need
operator cleanup before a full rebuild. Review the draft and remove only the
failed run's draft attachments before retrying; never change a published release.

Failures leave drafts unpublished. Published releases are immutable to the client.
Disabling this workflow leaves GitHub release production and installed-app updates
operating as before. This workflow does not publish standalone server archives or
rolling `main` prereleases.

## Local verification

Run `npm run test:release-config` and `openspec validate --all`. The focused transport
tests use an in-memory forge API and cover both-platform completion, checksum
failures, conflicting tags, unsafe file inputs, and immutable published releases.
Platform builds and notarization must additionally pass on the configured runners.
