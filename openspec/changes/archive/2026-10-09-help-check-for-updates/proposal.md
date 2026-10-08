## Why

Terminay checks for a newer release when it starts and once an hour afterwards.
Someone who knows a release was just published — most often the person who
published it — has no way to ask for a check now. The only route is to quit and
relaunch, which on a build holding a downloaded update installs that older
update first.

## What Changes

- The Help menu gains **Check for Updates…** as its first item.
- Choosing it checks the selected update channel immediately, regardless of how
  recently the last check ran.
- When the check settles, a native dialog reports the outcome: up to date, a
  newer release downloading, a downloaded update ready to install, a newer
  release this build cannot install in place, or the failure.
- The title-bar update action reflects the result straight away instead of at
  the renderer's next status poll.
- A manual check follows the same download, verification, and install rules as
  a scheduled one. It installs nothing by itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `settings-shortcuts-and-desktop-integration`: adds a manual update check to
  the desktop host's updater behaviour.

## Impact

- `electron/appUpdater.ts`: `check({ manual: true })` bypasses the hourly
  pacing; `describeManualCheck` words the outcome.
- `electron/main.ts`: the Help menu item, the result dialog, and the
  `updater.status.changed` broadcast.
- `packages/protocol/src/host.ts`: the payload-free `updater.status.changed`
  host event.
- `src/host/nativeEvents.ts`, `src/App.tsx`: re-read updater status on that
  event.
