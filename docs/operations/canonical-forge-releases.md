# Desktop releases on the canonical forge

`git.i.wylde.net/markwylde/terminay` builds its own macOS arm64 and Linux x64
desktop releases through **Actions → Trigger Release**. It does not download
GitHub binaries. GitHub continues its existing macOS, Linux, and Windows releases.
Applications from both forges continue to use the GitHub update feed.

## Runners and credentials

- `macos`: native Apple Silicon macOS runner with Xcode command-line tools,
  `curl`, `shasum`, `tar`, and a usable signing keychain.
  The workflow imports the Developer ID certificate and requires notarization.
- `ubuntu-latest`: native Linux x64 runner with Docker access for the project's
  glibc-floor image and terminal probes. Container paths and permissions must
  support `scripts/run-in-linux-floor.sh`.
- Node 24.15.0 is installed by setup-node on Linux. The macOS VM uses a shell
  step (`scripts/install-macos-node.sh`) shared with packaged macOS CI to install
  the checksum-pinned official arm64 archive into `RUNNER_TEMP`,
  avoiding setup-node, which failed its runner transport in run 23419.
  npm 12.2.1 is installed under
  `$HOME/.local` so the runner does not require a globally writable npm prefix.
- Repository secrets: `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`,
  `APPLE_APP_SPECIFIC_PASSWORD`, and `OPENROUTER_API_KEY` for AI release notes.
- Repository variables: `APPLE_ID`, `APPLE_TEAM_ID`.
- The forge-provided workflow token needs repository tag/release write access.
  No GitHub token, Windows runner, or separate artifact service is required.

The secret names and both Apple variables were confirmed present on the canonical
forge on 2026-11-04. Their validity still needs a real signed build.

## Dispatch

Select **Trigger Release → Run workflow** and choose `main`. No version input
is required. The workflow reuses `getNextVersion` from `scripts/release-utils.mjs`,
the same Conventional Commit rules used by GitHub: breaking changes bump major,
`feat` bumps minor, and other new commits bump patch. The latest stable tag is
the baseline; prerelease tags are excluded.

Both platform builds use the selected main commit. A tag already at that commit
is reused for its matching draft. If this workflow already published that commit's
release, preparation succeeds and the build/publication jobs are skipped.
Conflicting tags and releases owned by a different workflow still fail closed.
Tags can propagate through the existing repository mirroring; release publication
remains independent and this workflow does not mutate GitHub releases.

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
their checksums and exact inventory, and publishes the draft with the source SHA
and release notes.

AI notes are generated immediately after checkout and source verification, before
`npm ci`, smoke checks, draft creation, or either platform build. The workflow uses
`scripts/prepare-forge-release-notes.mjs` to call the shared GitHub generator and
prompt with the repository `OPENROUTER_API_KEY`. Missing credentials, HTTP 401,
or any generation failure stop preparation immediately. The canonical workflow
requires AI notes and does not silently fall back; GitHub retains its own fallback.

Successful notes are stored in the draft body after the preparation checks pass.
Publication reads that saved Markdown and does not call OpenRouter again. The
selected release range’s commit subjects, changed filenames and diff statistics
are sent to OpenRouter. Existing published releases are not rewritten.

## Failed runs and retries

Inspect the failed job and repair the runner or credentials. Re-run the original
workflow run to preserve its source SHA. A fresh dispatch after `main` advances
derives its own next version. Existing identical draft attachments are reused;
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
