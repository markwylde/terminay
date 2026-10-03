## Context

A shell is a child of whichever process calls `node-pty`'s `spawn`. Today that
is the server: in Desktop the embedded server runs inside the Electron main
process (`electron/main.ts:1566`, `electron/serverTerminalAuthority.ts:1050`),
and in standalone mode it is the service process (`apps/terminay-server/src/cli.ts:891`).
When the server exits the PTY master closes and the shell gets `SIGHUP`.

The rest of the stack already assumes the server, not a window, owns a session:

- `PtyProcess`/`PtyFactory` (`packages/server-core/src/terminalService/types.ts:76-117`)
  is the only process API `TerminalService` needs, and its header already
  anticipates an out-of-process host. It has `spawn` and no way to adopt.
- Clients resubscribe by session id and byte position; the replay ring is a
  1 MiB in-memory buffer per session (`service.ts:49`, `1348-1356`).
- Workspace state persists session identity, status, launch metadata and
  `outputPosition`, and panels persist `sessionId`, `cwd`, `title`
  (`workspace.ts:67-71`, `181-201`). It does not persist shell path, dimensions,
  or output.

Three places end sessions on purpose and must change:

- `TerminalService.shutdown()` kills every session with `SIGTERM`
  (`service.ts:1214-1245`); there is no detach path.
- `WorkspaceRepository.loadOnce` marks every `running` session `interrupted` on
  load (`workspaceRepository.ts:111-114`).
- `restoreWorkspaceOnStartup` then deletes every terminal panel and session and
  seeds one terminal per project (`workspaceStartup.ts:112-136`,
  `workspace.ts:1065-1112`).

Decided with the owner (see `questionnaires/scope.yaml`): every quit and
relaunch keeps sessions; Desktop and standalone; an unattached limit as a
setting defaulting to 5 minutes; output buffered while unattached; update
restarts never ask; an ordinary quit with busy terminals asks keep or end, and
ending removes the tabs; ended sessions keep their tab with last output and a
red notice. Windows is not a supported platform and is not designed for.

In-force ADRs that constrain this design: 0002 (state repository), 0004 (PTY
topology and distribution matrix), 0011 (trust boundaries), 0016 (side-by-side
server archives), 0017 (every project executes on its server), 0018 (hosts stay
protocol-blind), 0025 (agent sessions bound by process ancestry), 0027 (Desktop
in-place update), 0028 (no polling), 0031 (MCP authority), 0033 (pinned Node).

## Goals / Non-Goals

**Goals:**

- A server restart, for any reason, leaves every shell running and every tab,
  layout, title, and scrollback as it was.
- One mechanism for Desktop and standalone, inside `server-core`'s existing PTY
  seam, so hosts stay protocol-blind.
- The thing that outlives an update never has to be updated while it holds
  sessions.
- Nothing is left running without a bound the user chose.

**Non-Goals:**

- Surviving a machine restart or logout.
- Reviving a dead shell by replaying history into a new one.
- Windows.
- Restoring client-local presentation state (active tab, selection, search).
- Persisting scrollback of running sessions to disk.
- Changing the per-window close confirmation; it applies to closing a window,
  not to quitting.

## Decisions

### 1. A detached session holder owns PTYs; the server is its only client

A new process, the **session holder**, calls `node-pty` and keeps the PTY
masters. The server starts it detached (`setsid`, stdio closed, not a tracked
child) the first time it needs a session, and talks to it over a Unix socket.
`server-core` gets a `PtyFactory` implementation backed by the holder, so
`TerminalService` keeps one process API.

This crosses the **privileged-process boundary** of ADR-0011: the holder holds
shell environments and terminal bytes, so it is the same trust level as the
server and nothing below the server may reach it (Decision 6).

Alternatives considered:

- *Pass PTY file descriptors to the new server (`SCM_RIGHTS`), as iTerm2 does.*
  Smallest surviving process, but Node cannot receive arbitrary descriptors over
  a socket without a native addon, and `node-pty` cannot adopt a master it did
  not open. Two native surfaces to qualify per ADR-0004's release gate.
- *Run shells under `tmux`/`screen`.* A runtime dependency we do not ship, with
  its own escape-sequence and sizing behaviour between the shell and xterm.
- *Make the embedded server itself a detached daemon that Desktop connects to.*
  Survives an app restart but not a server update, which is the case the owner
  asked for, since Desktop and its server ship in one bundle.
- *Revive by replay (VS Code's cross-restart behaviour).* Loses running
  processes, which is the point.

### 2. One holder per data root per generation, not one per PTY

A holder serves every session of one data root. This replaces ADR-0004's "one
supervised child per PTY". A holder per shell would cost one Node (or
Electron-as-Node) process per terminal, roughly 40-80 MB each; twenty terminals
would be over a gigabyte for isolation that a holder crash rarely needs.

To avoid ever updating a holder that holds sessions, holders are **generations**.
A server attaches to every holder it finds for its data root. If the newest one
was started by a different build, the server starts a new generation for new
sessions and marks the older ones **drain-only**: they keep serving existing
sessions, refuse `spawn`, and exit when their last session ends. So a holder's
code and protocol are frozen for the life of its shells, and the server only
needs to keep speaking old protocol versions for as long as old shells live.

Trade-off accepted: a holder crash ends all sessions of that generation.

### 3. The holder protocol is small, versioned, and byte-oriented

Length-prefixed frames over the socket. `hello` carries the holder credential
and the protocol versions each side speaks; the highest common version wins. The
operations are: `list`, `spawn`, `write`, `resize`, `signal`, `end`, `end-all`,
`read(from position)`, `pause`/`resume`, `foreground` (the `node-pty` process
title, for hosts without a pid-based resolver), `set-limit`, `drain`, and the
events `data`, `exit`, and `foreground`. `list` returns, per session: session
id, pid, shell path, cwd at spawn, dimensions, output position, buffered range,
and exit record if it has ended.

Working-directory and foreground-process resolution stay in the server, using
the pid the holder reports; they are local-machine process inspection and do not
need the PTY master. `shellForeground` needs the shell path, which is why `list`
returns it (`nodePty.ts:129`).

The protocol is internal to Terminay Server. It is not part of the application
protocol and no client or host sees it, so ADR-0018's negotiation is untouched.

### 4. The holder is the authority for output and position

Each holder session keeps a ring of its most recent output, bounded at the
existing replay bound (1 MiB), and a monotonically increasing byte position that
is the session's `outputPosition`. The server's replay ring and presentation
checkpoint become caches: on adopt, the server reads the holder's buffered range
and rebuilds both, then subscribes from the end. Positions are therefore
continuous across restarts, and client resubscription by position needs no
change. A client whose acknowledged position has fallen out of the ring gets the
existing `replay_gap` path.

Flow control keeps its current shape: `pause`/`resume` map onto the frames, and
while no server is attached the holder keeps reading the PTY into the ring so a
shell never blocks on a full PTY buffer.

### 5. Lifetime: attach lease, unattached limit, tails

- The holder serves one attached server at a time. A second `hello` is refused
  while the first connection is open.
- When the server connection closes, the holder starts the unattached timer
  from the limit the server last sent with `set-limit`. This is a single timer,
  not a poll (ADR-0028). On expiry it saves tails, ends every session
  (`SIGHUP`, then `SIGKILL` after a bounded wait), and exits.
- "Until the machine restarts" disables the timer.
- **Tails.** On timer expiry, on `SIGTERM` (logout, shutdown), and when a
  session exits while unattached, the holder writes that session's ring to
  `<dataRoot>/session-tails/<sessionId>` with mode 0600 inside a 0700 directory,
  plus its exit record. The server reads tails at start-up for sessions the
  holder no longer has, and deletes a tail when its panel closes. Nothing is
  written for a running attached session. After `SIGKILL` or power loss there is
  no tail, and the panel shows the notice with no output.

This is a **data-at-rest boundary** change: terminal output reaches disk outside
recordings. It is bounded, owner-only, inside the data root, and tied to a panel
the user can close. A continuous on-disk journal was rejected because it would
write every running terminal's output to disk all the time for the sake of power
loss.

### 6. Access control

The socket is `<dataRoot>/session-holder/<generation>.sock`, mode 0600 in a 0700
directory, following `approval.sock` (`apps/terminay-server/src/remote/approvalSocket.ts:213-236`).
Beside it, `<generation>.json` (0600) records pid, build id, protocol versions,
and a random credential the holder generated. `hello` must present it. Node has
no portable peer-credential check, so the credential file is what binds a peer
to the data root's owner. No TCP listener is ever opened.

Renderers, browsers, extensions, and MCP never get the socket path or
credential. Terminal commands still enter through `TerminalService`, so session
and project authority (ADR-0011, ADR-0031) is enforced exactly where it is today.

### 7. Start-up reconciliation replaces the reaper

Start-up order in `composition.start()` becomes: attach holders, `list`, then
restore.

- `markInterruptedSessions` on load is replaced by reconciliation against the
  holder list: a persisted `running` session the holder has is adopted and stays
  `running`; one the holder reports as exited becomes `exited` with its code;
  one no holder knows becomes `interrupted` with `interruptedAt`. Existing
  status values are reused; no protocol enum changes.
- `discardStaleTerminalState` is no longer called at start-up. Panels stay.
- A holder session with no persisted session record (state lost or rolled back)
  is ended, so nothing runs that no panel can reach.
- `restoreWorkspaceOnStartup` seeds a terminal only for a project with a valid
  root and no terminal panel, which the existing condition already expresses
  once the reaper is gone.
- `TerminalService` gains `adopt(sessionId, handle)` beside `createResolvedSession`,
  and `shutdown({ detach: true })`, which unsubscribes and disconnects without
  signalling and without marking sessions.

Launch environment is injected once at spawn (`prepareTerminalSession`). Anything
in it that names a server endpoint or credential must stay valid across restarts.
The MCP control socket path and the session id are already stable; any
per-process token must be derived from or stored in the data root. This is
audited as a task before the reaper is removed.

The audit (task 6.1) found one value that did not survive:

| Injected value | Source | Across a restart |
| --- | --- | --- |
| Host environment, `COLORTERM`, `FORCE_HYPERLINK`, locale, profile variables | launch resolver, `electron/main.ts`, `cli.ts` | Stable: plain values. |
| `TERMINAY_EVENT`, `TERMINAY_AUTOMATION_ID`, `TERMINAY_TERMINAL_HANDLE` and the other automation variables | `automationService/executor.ts` | Stable: descriptive, and the handle is the session id. |
| `TERMINAY_CONTROL_SOCKET` | Desktop, `getTerminalControlEnv` | Stable: a fixed path in the data root. |
| `TERMINAY_CONTROL_TOKEN` | Desktop, `ControlCapabilityStore.mint` | **Not stable.** The store kept only an in-memory digest, and stopping the control endpoint revokes every capability. |
| Lifecycle `prepareTerminalSession` | `composeActivityLifecycle` | Returns no credentials; it registers the session with activity and agents, which adoption repeats. |

The standalone server mints no per-terminal token, so only Desktop is affected.

The control token is fixed by saving capability **digests** to
`<dataRoot>/mcp-capabilities.v1.json` (mode 0600) whenever the set changes, and
reinstating them at start-up for sessions that were adopted and are running. The
file holds SHA-256 digests, never tokens, so nothing in it can be presented to
the endpoint. Expiry is not extended, a saved entry claiming workspace reach
outside the automation space is discarded, and choosing to end terminals deletes
the file. MCP approvals stay in memory and are asked for again after a restart.
This touches the authority ADR-0031 describes without widening it: a capability
still names one terminal session and still ends when that terminal exits.

Agent status binds by process ancestry from the shell pid (ADR-0025). The shell
keeps its pid; its parent is now the holder, which is not an agent, so binding
is unaffected. This is verified by test rather than assumed.

### 8. Ended-session presentation reuses the exited terminal

A panel whose session is `exited` or `interrupted` after reconciliation renders
through the existing exited-terminal presentation, seeded from the tail, with an
error-styled notice: "This session has ended and can't be resumed." plus the
exit code when known. Input is not sent. Closing it is the existing close of an
exited terminal. Because the state is server-owned, Desktop and browser clients
show the same thing.

Found during apply: a panel that mounts onto a session that is already ended
never attached at all. It showed an error and an empty terminal, because an
exited session has no presentation checkpoint to hydrate from. The owner chose
to replay the saved raw output rather than keep a checkpoint for ended sessions.
The panel now opens the bounded read-only attach that kept automation terminals
already use, writes the retained output into its xterm once, detaches, and
disables input. The server allows that attach for any ended session whose panel
is still open when a session holder is in use; without a holder the rule is
unchanged. Output is shown at the panel's current size, so lines that were
wrapped at another width may wrap differently.

### 9. Desktop quit and update flows

`before-quit` (`electron/main.ts:5727-5762`) changes from "confirm, then kill" to:

- Restart to update: `requestRestartToUpdate()` sets the flag; the confirmation
  is skipped; shutdown detaches; `quitAndInstall` runs as today.
- Ordinary quit, no busy terminal: detach and quit.
- Ordinary quit, busy terminals: a three-button dialog. **Quit and Keep
  Terminals** (default) detaches. **Quit and End Terminals** sends `end-all`,
  then removes terminal panels and sessions through the existing
  `discardStaleTerminalState` path before the state file's final write, so the
  next launch seeds fresh terminals. **Cancel** clears the update flag as today.
- The dialog names the limit ("for up to 5 minutes", or "until this Mac
  restarts").

Graceful shutdown still stops MCP, remote exposure, automations, and agent
sessions; only the terminal step changes from kill to detach.

Server-side automations and agent sessions that are not terminal sessions do not
survive; they restart under their existing rules. Automation runs that execute
inside terminal sessions keep their shells, and how a run record reattaches is an
open question below.

### 10. Standalone: unit kill mode, upgrade, uninstall

The systemd unit has no `KillMode`, so the default `control-group` would kill
the holder on stop (`apps/terminay-cli/src/unit.ts:143-147`). The unit sets
`KillMode=process`: only the server receives `SIGTERM`. Every other child the
server starts (extension hosts, language servers, Git) must then exit on its own
when the server does; that is audited and tested, because `KillMode=process`
removes the service manager's cleanup.

The audit found one child that did not: the built-in agents extension host
survived a killed server indefinitely, with or without a session holder. Its
`disconnect` handler called `process.exit`, which joins worker threads first,
and a worker blocked in a system call never returns from the join. Under the
default kill mode systemd had been cleaning this up unnoticed. The child now
ends itself with a signal when its channel closes, which nothing an extension
does can hold up.

Units written before this change have no kill mode, so the first stop of an
upgrade would end every shell. `daemon upgrade` therefore adds the line and
reloads systemd before that stop. A unit that already names a kill mode is left
as its operator set it.

`daemon upgrade` already stops, switches `current`, and starts. The old
generation was started from `versions/<old>`; upgrade retains exactly one
previous version, so a drain-only holder two upgrades old could lose its
installation directory. The holder is therefore written to need nothing from
disk after start-up (Decision 11), and retention is unchanged.

`daemon uninstall` stops the service and then runs the installed server's
`end-sessions` command, which attaches to each holder with the data-root
credential, ends every session, and waits for the holders to exit. The CLI does
not speak the holder protocol itself: the server binary owns it, as it owns
`reset-identity`. `end-sessions` refuses while a running server is attached. If
the installed server cannot run it, uninstall says so and continues; the
unattached limit ends what is left.

### 11. Packaging: a holder must survive its own installation being replaced

The holder is one bundled JavaScript file plus `pty.node` (and `spawn-helper` on
macOS), loaded eagerly at start. A drain-only holder never spawns, so it never
needs `spawn-helper` or any lazy `require` again.

- Desktop runs it with the Electron binary in `ELECTRON_RUN_AS_NODE` mode,
  addressed through `app.asar`. It must not be addressed in
  `app.asar.unpacked`: `node-pty` finds its spawn helper by replacing
  `app.asar` with `app.asar.unpacked` in its own path, and a path that already
  contains the replacement becomes `app.asar.unpacked.unpacked`, so every spawn
  fails. A signed beta showed exactly that
  (`openspec/adr/evidence/session-holder-survives-update.md`). Squirrel.Mac
  replaces the bundle by moving it aside, so a running holder keeps its mapped
  files.
- Standalone runs it with the archive's bundled Node.

Three host behaviours are unproven and are settled by a spike before any other
task: whether Squirrel.Mac's installer waits on, or kills, a second process of
the same bundle; whether a holder survives an AppImage's FUSE mount being
unmounted when the main process exits; and whether macOS attributes the shells'
privacy permissions correctly once the app that spawned the holder has exited.
If AppImage cannot keep a holder alive, the fallback is to copy the holder
payload into the data root and run it from there.

## Risks / Trade-offs

- [A holder crash ends every session of its generation] → the holder does
  nothing but shuttle bytes and keep rings; it loads no extensions and parses no
  terminal output. Sessions are reconciled to `interrupted` with whatever tail
  exists.
- [Old holder protocols must be kept speakable] → bounded by shell lifetime and
  the unattached limit; the server refuses versions it cannot speak, shows those
  sessions as ended, and tells the holder to end them. A conformance test pins
  every released protocol version.
- [Processes left running that the user forgot] → the default limit is 5
  minutes, the quit dialog states it, and `end-all` exists on every exit path.
- [`KillMode=process` leaks server children] → audit and test that every server
  child exits when the server does; the unit keeps `TimeoutStopSec`.
- [Injected environment goes stale after restart] → audited before the reaper is
  removed; any per-process credential becomes data-root-derived.
- [Tails put terminal output on disk] → bounded, 0600, deleted with the panel,
  never written for running attached sessions; documented in the security notes
  of the operations runbook.
- [E2E tests leak holders between runs] → test data roots set the limit to zero
  and teardown sends `end-all`; a leaked-holder check fails the suite.
- [Two Desktop instances on one data root] → unchanged: the single-instance lock
  and the holder's one-server lease.
- [Update install blocked or holder killed by the installer] → the spike in
  Decision 11 gates the design; a negative result changes how the holder is
  launched, not the contract.

## Migration Plan

1. Land the holder, the holder-backed factory, and adopt/detach behind a switch
   that defaults off. Both hosts keep spawning in-process. Done.
2. Turn it on by default. The owner chose a single step after the macOS update
   and systemd checks passed: on in `main`, so beta users get it first and
   stable users with the next tagged release. One shared rule decides it for
   both hosts (`sessionHolderEnabled`): on unless `TERMINAY_SESSION_HOLDER=0`;
   off under the test marker unless asked for, so a harness never leaves a
   holder behind; and off where it cannot work, on Windows and for a data root
   too deep for the holder's socket path, where terminals end with the server
   as before rather than failing to start.
3. The first restart onto a build with the holder still loses sessions, because
   they were spawned in-process by the old build. That one start restores as it
   always did: on a data root that has never had a holder or a saved tail, stale
   terminal panels are discarded and each project gets a fresh terminal, instead
   of being greeted by dead, empty tabs. From the next restart on, terminals
   survive and ended ones keep their panels.
4. Rollback is `TERMINAY_SESSION_HOLDER=0`, or reverting the default. A build
   without a holder does not attach to one, so sessions held at that point end
   when their unattached limit passes.

`desktop-auto-update` should be archived first. Its "Restart to update" scenario
then needs its "including any confirmation that path requires" clause removed to
agree with this change's "Restart to update keeps terminals" requirement.

## Open Questions

- **ADR-0004 is revisited.** Its "one supervised child per PTY" does not hold
  for a shared holder. The adr step records a superseding ADR that restates the
  distribution matrix unchanged.
- **Automation runs (decided).** A run does not span a restart. A graceful
  shutdown stops runs in progress and ends their terminals, as it always has:
  the executor is disposed before terminals are let go. After a crash, the run
  log records the run as stopped on the next start; its shell, if the holder
  still has it, is reattached as an ordinary terminal in the automation space.
  Nothing was changed to get this.
- **Recordings (decided).** A recording ends as interrupted when the server
  shuts down and is not resumed for a reattached terminal.
- **Limit choices.** The setting's value list beyond "5 minutes" and "until the
  machine restarts" (proposed: 1 minute, 5 minutes, 30 minutes, 2 hours, until
  restart).
