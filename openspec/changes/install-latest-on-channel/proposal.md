## Why

A user who moves from Nightly or Canary back to Stable stays on the prerelease
build until a newer stable release ships, which can take weeks. Nothing in
Settings lets them say "put me on what this channel publishes now". A remote
server has the same gap: once it is ahead of its channel, or a build it runs
misbehaves, getting back to the channel's current release means a shell on the
host and `terminay daemon upgrade --allow-downgrade`.

Both updaters refuse to downgrade. That is the right default for automatic
updates. But the user has no way to override it on purpose, and ADR-0110 and
ADR-0062 rule it out by decision.

## What Changes

- **This Mac → Updates** gains an **Install latest on <channel>** action. It is
  always shown and names the version the selected channel publishes now. On a
  prerelease channel that is the higher of that prerelease and the latest stable
  release. When that version is older than the running build, the action is a
  downgrade. When it is the running build, the action is shown disabled, with
  the reason.
- A confirmation dialog shows the running and target versions and, for a
  downgrade, warns that settings and state written by the newer build might not
  carry over. Confirming downloads the build, then restarts into it.
- **A remote server's Updates page** gains the same action. It installs the
  newest signed release on that server's own installed channel, even when that
  release is older than the running one. It uses the same confirmation, and
  terminals survive exactly as they do in an ordinary in-place upgrade.
- The server's upgrade status reports the channel's latest release even when it
  is not newer. An upgrade request gains one boolean, `allowOlder`, and still
  names no version.
- A system-scope server gets a second fixed, root-owned trigger for the
  downgrading upgrade. A container server can go no lower than the release
  built into its image, so below that the action is unavailable, with the
  reason.
- Automatic updates, update notices, and changing the channel still never
  install an older build.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: Desktop gains an explicit,
  confirmed Install latest on <channel> action that may downgrade. Automatic
  updates and channel changes stay non-downgrading.
- `server-upgrade`: status reports the channel's latest release even when it is
  not newer. A paired device may request that release with `allowOlder`, which
  replaces "never move to an older release" for that one explicit request. A
  container also has a floor: it cannot go below its image's release.
- `daemon-cli`: `daemon upgrade --check` reports `latest`, and the system-scope
  helper gains a second fixed unit pair that runs with `--allow-downgrade`.
- `connections-and-client-hosts`: a server's Updates page and its upgrade dialog
  offer Install latest on <channel>, with a downgrade warning.

## Impact

- `electron/appUpdater.ts`, `electron/main.ts`, preload, and the Desktop Updates
  page (`src/components/settings/`): a new `installLatest` updater operation that
  enables `allowDowngrade` for that one check and download only.
- `apps/terminay-cli` (`daemon upgrade --check` reports `latest`; the root
  oneshot gets a second fixed unit that passes `--allow-downgrade`),
  `apps/terminay-server/src/releaseUpgrader.ts`, the `server.upgrade` protocol
  operation, `src/workspace/SettingsServerUpdates.tsx`,
  `ServerUpgradeDialog.tsx`, and `updatesPageModel.ts`.
- System-scope install layout: one new systemd path and service unit pair.
- A new ADR supersedes ADR-0062 decision 1 and ADR-0110 decision 5.
- Ordering: this change modifies requirements introduced by the unarchived
  changes `three-release-tracks` and `remote-server-in-app-upgrade`, so it is
  archived after them.
