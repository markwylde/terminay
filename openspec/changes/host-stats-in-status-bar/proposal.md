## Why

There is no quick way to see how busy the machine behind a project is. When a
build crawls or a terminal stalls, the user has to open another terminal and
run `top`, `htop` or `iostat` to learn whether the host is short of CPU,
memory, network or disk. With a remote Terminay Server that machine is not the
one in front of the user, so the operating system's own monitors do not help.

## What Changes

- The status bar can show small live graphs with current figures for the CPU,
  memory, network and disk I/O of the machine that runs the active tab's
  Terminay Server. That is the remote host for a remote server and this
  computer for the Desktop Local server.
- The graphs are off by default. A device-local setting in Settings turns them
  on, and a second device-local setting chooses the sampling interval. The
  default is 5 seconds and any whole number of seconds from 1 to 3600 is
  allowed.
- The server samples its host only while at least one client is subscribed,
  at the shortest interval any subscriber asked for. It stops once the last
  subscriber leaves. A client subscribes only while the setting is on and its
  document is visible.
- A metric the host cannot report, for example disk I/O on a platform without
  a counter source, is left out rather than shown as zero.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-status-bar`: host stats in the status bar, how they are sampled,
  and the preference that turns them on.

## Impact

- `packages/protocol`: a host-stats subscribe/unsubscribe request and a
  pushed sample event.
- `apps/terminay-server` / `packages/server-core`: a host-stats sampler owned by
  its subscribers. This is an owner-approved ADR-0028 poll.
- `src/workspace/WorkspaceStatusBar.tsx`, a new host-stats model and hook,
  `src/App.tsx`, the status bar CSS.
- `src/types/settings.ts`, `src/terminalSettings.ts`: device-local
  `hostStats.enabled` and `hostStats.intervalSeconds`.
- Tests: sampler and model unit tests, settings normalisation, an E2E scenario.
