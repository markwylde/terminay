## Why

Updating Terminay Desktop today means the "Update Now" button opens the GitHub
release page, and the user downloads the DMG or AppImage and reinstalls it by
hand. Most people put it off, so installs stay on old builds long after a fix
has shipped. The button also says nothing about what changed, so the user has
no reason to bother.

Technically, the desktop checks for updates by following the `releases/latest`
redirect and parsing the tag out of the URL. That tells it a version number and
nothing else. There is no update metadata to download against, no integrity
data to verify against, and no way to follow the rolling `main` prerelease.

## What Changes

- Packaged macOS and Linux (AppImage) builds update themselves with
  `electron-updater`. A newer release is downloaded in the background and
  verified against the SHA-512 in its published update metadata. On macOS,
  Squirrel.Mac also requires the new bundle to carry the same code-signing
  identity as the one installed.
- Once the update is downloaded, the title-bar action becomes **Restart to
  update**. Any downloaded update that hasn't been installed is installed when
  the user next quits Terminay.
- A **What's new** dialog shows the release notes for every stable release
  between the installed version and the downloaded one, newest first. Notes
  come from the GitHub release bodies and are rendered as sanitized Markdown.
- An **Update channel** device setting (`Stable` / `Beta`). Beta follows the
  rolling `main-latest` prerelease. Its release notes are the commit summaries
  since the last stable tag.
- Builds that cannot update themselves (unpackaged/dev builds, and Linux
  installs that are not a writable AppImage) keep today's behaviour: they
  report that a newer release exists and open its release page.
- Release pipeline: the macOS target adds a signed, notarized `zip` beside the
  `dmg`. Tagged releases publish `latest-mac.yml` and `latest-linux.yml` last,
  after the release notes are set, so no client sees an update before its
  changelog exists.
- The rolling `main` prerelease adds signed and notarized macOS desktop builds,
  Linux AppImage desktop builds, and `beta-mac.yml` / `beta-linux.yml`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: "Update availability checks"
  becomes an in-place update contract: background download and integrity
  verification, restart-to-install and install-on-quit, a release-notes
  dialog, an update-channel device setting, and the notify-and-link fallback
  for builds that cannot install in place.

## Impact

- `electron/main.ts`: the hand-rolled `fetchAppUpdateStatus` redirect parse is
  replaced by a new `electron/appUpdater.ts` built on `electron-updater`.
- `packages/protocol/src/host.ts`: the `updater` capability gains an
  `updater.install` action, and the status it returns grows (state, release
  notes, whether in-place install is supported).
- `src/App.tsx`, `src/host/nativeActions.ts`, `src/types/terminay.ts`: the
  title-bar action states and a new release-notes dialog.
- `src/terminalSettings.ts`, `src/types/settings.ts`: the `updateChannel`
  device setting.
- `electron-builder.json5`, `package.json` (`build:mac` adds `zip`, a
  `publish` block, and the new `electron-updater` runtime dependency).
- `.github/workflows/trigger-release.yml` and `main-prerelease.yml`, plus the
  release-contract tests under `scripts/` that pin their asset sets.
- New runtime dependency: `electron-updater` (maintained alongside the
  `electron-builder` already in use).
