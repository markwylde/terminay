## Why

Someone on the Beta update channel is left behind when a stable release ships.
On 2026-09-21 Terminay 5.8.0 was released while Beta installs kept being offered
5.8.0-beta.15, an older build, and would have been until the next push to
`main` published a newer beta. People opt in to Beta to get changes sooner, never
later, and the convention everywhere else (electron-updater's own GitHub
provider, browsers, editors, package managers) is that a prerelease channel is
stable plus prereleases.

The cause is that the Beta channel reads exactly one feed, the rolling
`main-latest` prerelease, and never looks at tagged releases.

## What Changes

- A check on the Beta channel considers both the rolling `main-latest` build and
  the latest stable release, and offers whichever version is higher.
- A stable release offered to a Beta install behaves as it does on Stable: it is
  downloaded and verified from the tagged release, its What's new lists the
  stable release notes, and its release link opens the tagged release page.
- The installation stays on the Beta channel. When `main` next publishes a beta
  newer than the installed stable version, that beta is offered as usual.
- Nothing older than the running version is ever offered, as today.
- If one of the two feeds cannot be read, the check proceeds with the other; it
  fails only when neither can be read.
- The Stable channel is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds the rule that the Beta
  update channel also follows stable releases.

## Impact

- `electron/appUpdater.ts`: Beta checks choose a source feed before checking;
  release notes and the release link follow the source of the offered version
  rather than the selected channel.
- `scripts/app-updater.test.mjs`: coverage for feed selection, fallback, notes,
  and no-downgrade on Beta.
- No change to the release pipeline, the published assets, the host protocol,
  the renderer, or the settings UI. Two small HTTPS requests to GitHub release
  assets are added per Beta check (at most hourly, plus manual checks).
