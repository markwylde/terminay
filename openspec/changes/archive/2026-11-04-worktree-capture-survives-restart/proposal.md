## Why

After Terminay restarts or updates, a terminal that was kept running no longer moves into the folder of a worktree it creates. It stays in General, and the new folder appears empty. Most terminals live across at least one update, so this is the usual case rather than an edge case.

The cause is that the Git reporting from ADR-0052 is tied to one server run. Each start listens on a socket with a random name and keeps each terminal's token only in memory. A shell launched before the restart still names the old socket and an old token, so Git's report of `worktree add` reaches nobody. The fallback process lookup then loses its race against Git on most repositories. The diagnostics added in PR #402 confirmed this on 2026-10-17. They showed no `command.reported` event, `source: none`, and a shell older than the server it was talking to.

## What Changes

- The socket Git reports to has one fixed path per server, so a shell started by an earlier run of the same server still reaches it.
- Each terminal session's Git reporting token is derived from its session id with a key kept in the data directory. A restarted server therefore recognises the token of every session it re-adopts from the session holder.
- A socket left behind by a run that crashed does not stop the next run listening at the same address.
- No new user-facing setting, protocol message, or client change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: worktree capture works for a terminal that has outlived a server restart.

## Impact

- `packages/server-core/src/worktreeCapture.ts`: `GitCommandStream` derives tokens from a data-directory key and gains token adoption.
- `apps/terminay-server/src/gitCommandSocket.ts` (new) and `mcp/controlSocketPlacement.ts`: the fixed socket placement and key loading shared by both hosts.
- `packages/server-core/src/composition.ts`: re-adopted sessions register their token before any Git event can arrive.
- `electron/serverTerminalAuthority.ts` and `apps/terminay-server/src/cli.ts`: the socket path no longer has a random part.
- ADR-0069 supersedes ADR-0052. Git reporting now survives a server restart, and ADR-0052's other decisions carry forward.
