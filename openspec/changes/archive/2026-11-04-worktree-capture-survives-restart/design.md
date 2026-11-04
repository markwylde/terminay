## Context

Worktree capture (ADR-0052) learns which terminal ran `git worktree add` from Git's own Trace2 report. Terminay launches each terminal with `GIT_TRACE2_EVENT` naming a Unix socket the server listens on, and `GIT_TRACE2_PARENT_SID` set to a token for that session. The server maps the token in each report back to a session.

Both halves only last as long as one server run:

- The socket path is `tmpdir()/terminay-git-<serverId hash>-<4 random bytes>.sock` (`electron/serverTerminalAuthority.ts`, `apps/terminay-server/src/cli.ts`), so every start gets a new address.
- Tokens are random and live only in `GitCommandStream`'s in-memory maps (`packages/server-core/src/worktreeCapture.ts`).

Terminals do outlive the server. The session holder (ADR-0035) keeps shells running through a restart, and `reattachHeldSessions` re-adopts them under the same session id. A re-adopted shell still has the old run's address and token in its environment, so its Git reports reach a socket that no longer exists. On 2026-10-17 the capture diagnostics showed exactly this: no `command.reported` event, and a shell from 06:19 talking to a server started at 08:43. The fallback process lookup cannot rescue it, because Git finishes before the watch fires on most repositories.

ADR-0054 already anticipated this. It says a socket handed to a terminal that may outlive the server cannot have a random address, and it places fixed-address sockets in the data directory, or in an owner-only runtime directory named for it.

## Goals / Non-Goals

**Goals:**
- A shell from an earlier run of the same server reaches the current run's Git socket.
- The current run recognises the token of every session it re-adopts, with no help from the shell.
- A socket left behind by a run that crashed does not stop the next run listening.

**Non-Goals:**
- Repairing shells launched before this change ships. They carry a random address and a random token that no later run can know about. They recover when the terminal is reopened.
- Windows named pipes. Git's Trace2 socket target is a Unix socket, and the Windows path stays as it is.
- Any change to what capture does once it knows the creator.

## Decisions

### 1. The Git socket has a fixed address, placed per ADR-0054

The socket is `terminay-git.sock` in the data directory when that path fits within the shared limit (`SESSION_HOLDER_MAX_SOCKET_PATH_BYTES`). Otherwise it is `git.sock` in the same owner-only runtime directory the control socket uses (`controlSocketRuntimeDirectory`), which is named for the data directory. The placement helper in `apps/terminay-server/src/mcp/controlSocketPlacement.ts` is generalised to take the file names, so the control socket and the Git socket resolve the same way. A host without a data directory keeps a per-run address in the temporary directory. It has no session holder either, so it has no surviving shells to serve.

*Alternatives:*
- **Hash the server id into a fixed name in the temporary directory.** This is today's path without the random part. It is short, but ADR-0054 rejects ad hoc placement: a shared temporary directory can be pre-created by another user, and the runtime directory rule exists to refuse that.
- **Re-send the address to running shells.** There is no channel to change a running process's environment.

*Boundary:* the socket is a local channel to the Terminay Server, and it stays owner-only. A shell can reach it, but reaching it grants nothing (decision 3).

### 2. A session's token is derived from its id with a per-data-directory key

`token = "terminay-" + hex(HMAC-SHA256(key, sessionId))[0..24]`. The 32-byte `key` is created once in the data directory as `git-trace.key`, mode 0600. It is read at start-up and never sent anywhere. `GitCommandStream` computes the token in `environmentFor` and registers it in the token map. A new `adopt(sessionId)` registers a re-adopted session's token, and `reattachHeldSessions` calls it for every session it re-adopts, before any Git event for that session can be handled. `release(sessionId)` on exit is unchanged, so a token stops being recognised once its session ends, even though the same id would produce the same token again.

*Alternatives:*
- **Persist each random token in the session holder's record.** That needs a holder protocol change, and it fails for every session held by a holder from an earlier release, which is exactly the population an update produces. Holders outlive the server that started them.
- **Persist a token map in the data directory.** More moving parts: writes on every launch and exit, plus pruning. It also gains nothing over a derivation from data the server already has.
- **Identify the shell from the Git pid in the Trace2 `sid`.** That is a process-table walk on every event, the same race and cost ADR-0052 moved away from.

*Boundary:* the token stays an attribution label, never a credential (ADR-0052 decision 7). It is unforgeable without the key and unique per session, and it is only honoured while its session is live on this server. A report with an unknown or released token is ignored, as today.

### 3. One run listens at a time, and a stale socket is replaced

Two runs on one data directory never overlap. Desktop holds Electron's single-instance lock for its user-data directory, and the standalone server holds its data-root lease. Both are taken before the server starts and released only when it has stopped. So a fixed address is never contended by a live run. `listen` keeps removing whatever is at the path before binding, so a socket left by a crashed run does not block start-up.

*Alternative:* have a stopping run remove the path only while it is still its own file, by recording the device and inode at bind time. This does not work. Node's `net.Server.close()` unlinks a Unix socket by name inside libuv, so the old run would remove a newer run's socket anyway. Making it safe would need indirection, such as a unique socket file behind a symbolic link, to guard against an overlap the locks already rule out.

### 4. Diagnostics name the condition

`command.reported` already distinguishes `attributed: false`. A start-up report states where the socket was placed (`data-directory`, `runtime-directory`, or `per-run`) and how many tokens were adopted, so the next miss shows whether this path was in play.

## Risks / Trade-offs

- [Shells launched before the fix never report] → This is accepted and stated in the release notes. Reopening the terminal fixes it.
- [The key file is lost or replaced, for example when a backup is restored without it] → Re-adopted shells stop being recognised until reopened. This degrades to today's behaviour, never to a wrong attribution.
- [The runtime directory fails ADR-0054's ownership checks] → The Git stream does not listen, and capture uses the process lookup, as when the socket cannot be created today. The failure is reported. Start-up is not refused for this optional channel.
- [A future host runs two servers on one data directory without a lock] → The later run takes the address, and the earlier one removes it when it closes. Any host that serves a data directory must hold an exclusive lock on it, as both hosts do today.

## Migration Plan

No data migration. The first run with this change creates `git-trace.key` and listens on the fixed address. Shells started from then on survive later restarts. Rollback only means earlier releases go back to a random address; the key file is ignored.

## Open Questions

- ADR-0052 decision 1 says the token is "a random token unique to the terminal session". A keyed derivation is still unpredictable and unique, but it is not random per launch. The ADR step records a decision that supersedes ADR-0052 and carries its other decisions forward unchanged.
