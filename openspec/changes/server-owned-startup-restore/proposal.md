## Why

Pair a browser with a daemon that has been restarted and the workspace comes back carrying tabs for terminals whose processes are gone. Each one says "This terminal has exited", and no live terminal is created, so the first thing a returning operator does is open one by hand.

Desktop does not do this. It removes the stale panels and seeds a replacement terminal per project. The behaviour is not shared because the code is not shared: the recovery lives in `electron/serverTerminalAuthority.ts`, the Desktop host's own bootstrap, and the daemon's bootstrap in `apps/terminay-server/src/cli.ts` seeds a terminal only when the workspace file did not previously exist.

That is a boundary problem before it is a bug. ADR-0008 makes the server the only owner of workspace state and makes hosts presentation shells; a host that decides what a restored workspace contains is doing the server's job. Both hosts already build the same core through `createServerCoreComposition`, whose `start()` is already where startup recovery happens for project environments. Startup recovery for terminals belongs beside it, and then neither host has an opinion to disagree about.

## What Changes

- Workspace startup restore becomes server-owned: discarding terminal panels and sessions whose processes did not survive the restart, and seeding one terminal per restored project, run from `createServerCoreComposition().start()` for every host.
- `WorkspaceStore.discardStaleLocalTerminalState` is renamed `discardStaleTerminalState`. The condition was never "Desktop restarted", it was "the process that owned these PTYs is gone".
- The Desktop authority keeps only what is host-specific — rebuilding its process-local file, Git, and documentation bindings — and delegates the rest.
- The daemon's `ensureDefaultTerminalSession` and its first-run-only gate are removed, because the shared restore covers both the first run and every restart.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-owned-workspace-state`: restart recovery is required of the server for every host rather than of Desktop, and is stated in terms of the process that owned the terminals.

## Impact

- `packages/server-core/src/workspaceStartup.ts` (new), `packages/server-core/src/workspace.ts`, `packages/server-core/src/composition.ts`
- `electron/serverTerminalAuthority.ts`, `apps/terminay-server/src/cli.ts`
- Out of scope, and left for a later change: the file-catalog, documentation, MDX, and file-content project contexts that still live in the Desktop authority.
