## Why

People who want early builds have one choice, Beta, which changes on every push to `main`. There is nothing between that and Stable, which ships about every five days, so anyone who wants fresh builds without a new one every hour has nowhere to go.

Every Beta build is also notarized by Apple. Apple's documented guidance is 75 notarizations a day, and a build per push does not fit inside that as the push rate grows. A signing or notarization outage also blocks every Beta build.

## What Changes

- Three update tracks replace two: **Stable**, **Nightly** and **Canary**. All three build from `main`.
  - **Stable**: unchanged. Built fresh, signed and notarized when the release workflow is dispatched.
  - **Nightly**: built once a night from the head of `main`, skipped when `main` has not changed since the last nightly. Signed and notarized on macOS.
  - **Canary**: built on every push to `main` (one build per push, not per commit). Signed on macOS but **not notarized**.
- **BREAKING**: the Beta update channel is removed. A saved Beta setting becomes Nightly. Installed Beta builds keep receiving updates: for 90 days the nightly build is also published on the feed they read, and the first one they install moves them to Nightly.
- Prerelease versions change from `<next>-beta.<run>` to `<next>-main.<commit count>.nightly` and `<next>-main.<commit count>.canary`, so builds from different tracks order by commit.
- The updater and **Settings > Updates** offer Stable, Nightly and Canary. Nightly and Canary each also follow Stable, as Beta does today.
- Canary has its own rolling release, `canary-latest`, holding its desktop payloads, update metadata and server archives. Nightly takes over the existing `main-latest` rolling release.
- Server artifacts follow the same split. `daemon install main` and the `main` server channel become nightly. A new `canary` reference and channel follow the canary release. The image publishes `nightly` and `canary` moving tags in place of `beta`, which follows nightly for the same 90 days.
- Add connection names the server that matches the client's track: a Canary Desktop names the canary image and `daemon install canary`.
- No canary desktop payload is linked for download. Gatekeeper blocks an un-notarized app downloaded in a browser, so Canary is reached only by switching track inside an installed Stable or Nightly build.

## Capabilities

### New Capabilities

- `release-tracks`: the three tracks, what triggers each, how their versions are formed and ordered, the signing and notarization each carries, and where each is published.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: the update channel setting offers Stable, Nightly and Canary; both prerelease channels follow Stable; release notes and the macOS floor declaration cover both prerelease channels.
- `server-runtime-and-protocol`: rolling server archives are published per track (nightly as `main`, canary as `canary`), the artifact manifest records `canary` as a channel, and the Windows installer probe runs on every track.
- `daemon-cli`: `daemon install` and `daemon upgrade` accept `canary`, and a canary install follows the canary channel.
- `server-upgrade`: a canary install checks for a newer canary revision.
- `container-image`: an image is published for every nightly and canary build; the moving tags are `latest`, `nightly` and `canary`.
- `connections-and-client-hosts`: install commands name the image and installer channel that match a Nightly or Canary client.

## Impact

- **Workflows** (`.github/workflows/`): `main-prerelease.yml` becomes the canary workflow, without notarization and publishing to `canary-latest`. A new scheduled nightly workflow publishes to `main-latest`. `server-image.yml` accepts the new version grammar and tags. `trigger-release.yml` is unchanged in behaviour.
- **Scripts** (`scripts/`): `main-beta-version.mjs`, `build-main-beta-desktop.sh`, `verify-update-metadata.mjs`, `sync-package-version.mjs`, the Windows update probe, and their tests take a track and the new version form.
- **Desktop** (`electron/appUpdater.ts`, `electron/main.ts`, `src/terminalSettings.ts`, `src/types/`, `src/components/AppUpdateDialog.tsx`): three channels, three feeds, settings normalisation.
- **Install commands** (`src/shared/serverInstallCommands.ts`): version grammar and channel per track.
- **CLI and server** (`apps/terminay-cli`, the server's release check): a `canary` reference and channel; image references accept the new grammar.
- **Docs**: `docs/operations/docker-image-release.md` and release runbooks.
- **Apple**: notarization submissions drop from one per push to about one a day plus stable releases.
- **Other changes in flight**: `pairing-install-instructions-and-beta-image`, `official-container-image` and `remote-server-in-app-upgrade` own requirements this change modifies and must be archived first.
- **Follow-up**: a later change removes the legacy `beta-*.yml` feed and the `beta` image tag once the 90 days have passed.
