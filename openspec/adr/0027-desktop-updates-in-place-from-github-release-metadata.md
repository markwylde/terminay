# ADR-0027: Terminay Desktop updates in place from GitHub release metadata, which is published last

Status: accepted
Date: 2026-09-19

## Context

Terminay Desktop has only ever detected that a newer tag exists and sent the
user to the release page. Installing by hand is slow enough that installs lag
far behind fixes. `electron-updater`, maintained with the `electron-builder`
that already packages the app, can download, verify, and install an update in
place using nothing but files attached to GitHub releases. For that to be safe,
the files have to be trustworthy and have to appear only when a release is
complete, and the release pipeline currently publishes assets before the
release notes. ADR-0016 already makes the `main-latest` prerelease a rolling
channel for server archives.

## Decision

1. Packaged macOS builds and Linux AppImage builds update in place with
   `electron-updater`. The update runs in the privileged main process. A
   payload is installed only when its SHA-512 matches the channel metadata,
   and on macOS only when Squirrel.Mac confirms that the new bundle satisfies
   the running app's designated code requirement. Builds that cannot install
   in place (unpackaged builds, and Linux builds that are not a writable
   AppImage) only notify the user and link to the release page.
2. The stable channel is tagged GitHub releases, and its metadata files are
   `latest-mac.yml` and `latest-linux.yml`. The release pipeline attaches them
   after the release body is final, so they are the last assets attached.
3. The beta channel is the rolling `main-latest` prerelease. Its versions are
   `<next stable version>-beta.<run number>`, and its metadata files are
   `beta-mac.yml` and `beta-linux.yml`. They point at fixed asset names and
   are renamed into place after every payload has been uploaded.
4. The update channel is a device setting. It is never server-owned, because
   it decides which binary runs on that machine.
5. The renderer only reads update status and asks for a restart to install.
   It never names a URL, path, or version to install.

## Consequences

- The macOS release target gains a `zip`, which Squirrel.Mac requires. Every
  merge to `main` pays for one macOS signing and notarization run.
- Changing the Apple Team ID breaks in-place updates. Users would have to
  reinstall by hand.
- If the pipeline stops publishing `*-mac.yml`/`*-linux.yml`, updates stop for
  every installed client. The release-contract tests pin these assets.
- Windows can join later by publishing `latest.yml` beside its NSIS build.
  Nothing else in this decision changes.
