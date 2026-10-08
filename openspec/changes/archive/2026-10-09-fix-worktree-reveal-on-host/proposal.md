## Why

**Reveal in OS** on a worktree row does nothing. Since Git moved behind the
server, the renderer's Git client refuses to reveal without a client-side
`nativeWindows` capability it is never given, and the embedded server's Git
adapter has no reveal handler to call even if it were. The item is also offered
in browser and remote views, where revealing a folder on some other machine
makes no sense.

## What Changes

- The embedded server reveals a worktree in the OS file manager when the
  request comes from one of its own Desktop windows.
- Each worktree listing tells the requesting client whether reveal is available
  to it. The Worktrees panel and the shared Git route offer reveal only then, so
  browser, remote, and standalone-server clients never see it.
- The Git client no longer requires a client-side native capability to reveal;
  the server decides.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `git-worktrees-and-quick-push`: adds a requirement that worktree reveal runs
  on the server host and is offered only to that host's own windows.

## Impact

- `packages/server-core/src/gitService/adapter.ts` — `canRevealOnHost` option and
  `revealAvailable` on listings.
- `electron/serverTerminalAuthority.ts`, `electron/main.ts` — reveal handler
  gated on embedded renderer client IDs, backed by `shell.showItemInFolder`.
- `packages/client-core/src/gitClient.ts` — reveal no longer checks a client
  capability.
- `src/services/git/serverGitWorkspaceAdapter.ts`,
  `src/components/git-panel/WorktreesPanel.tsx`,
  `src/workspace/useFileExplorerController.ts`,
  `src/shared/SharedGitRouteBody.tsx` — gate and report reveal.
