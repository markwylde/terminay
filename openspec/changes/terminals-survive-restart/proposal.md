## Why

Quitting Terminay ends every shell. A user who restarts to take an update, or
whose app crashes, comes back to one fresh terminal per project: the tabs, the
layout, the scrollback, and whatever was running are gone. Terminals such as
iTerm2 restart onto a new version with every session intact, and Terminay now
updates in place, so the cost of this is paid on every release.

The cause is process ownership. Shells are spawned by the server, which in
Desktop runs inside the Electron main process and in standalone mode is the
service process, so they die with it. The specs say so on purpose: a server
restart discards terminal tabs and seeds a fresh one.

## What Changes

- Shells are owned by a small detached **session holder** process per server
  data root. It outlives the server and Desktop, keeps each shell's PTY and a
  bounded output buffer, and hands live sessions back to the next server that
  starts on that data root.
- **BREAKING** A server restart restores terminal tabs. Projects come back with
  the same terminal panels, layout, titles, scrollback, and running processes,
  instead of one fresh terminal each.
- Output produced while nothing is attached is buffered, bounded per session,
  and replayed after the restart.
- A session that ended while nothing was attached keeps its tab. The tab shows
  the last output Terminay has and a notice that the session has ended and
  cannot be resumed.
- Unattached sessions end after a limit. The limit is a server setting,
  defaulting to 5 minutes, and can be set to last until the machine restarts.
- **BREAKING** Quitting Terminay Desktop no longer ends terminals by default.
  When any terminal is running something, the quit prompt asks whether to keep
  terminals running in the background or end them. Ending them closes their
  tabs. When every terminal is idle, quitting keeps them without asking.
- **Restart to update** keeps every terminal and never asks.
- The standalone server gets the same behaviour: `terminay daemon upgrade`, a
  service restart, and a server crash keep sessions. `daemon uninstall` ends
  them.
- macOS and Linux only, which is the whole supported matrix.

## Capabilities

### New Capabilities

- `persistent-terminal-sessions`: terminal sessions that outlive the server
  process — detached ownership, reattachment, buffered output, the unattached
  lifetime limit, ended-session presentation, and holder access control.

### Modified Capabilities

- `server-runtime-and-protocol`: session lifetime now extends across a
  server-process restart; the non-goal that PTYs do not survive one is removed.
- `server-owned-workspace-state`: restart reattaches live sessions and restores
  terminal panels instead of discarding them and seeding fresh terminals.
- `terminal-workspace`: a restart no longer marks live sessions interrupted;
  only sessions that could not be reattached are marked.
- `workspace-and-project-tabs`: a restored project receives a fresh terminal
  only when it has no terminal panel left.
- `settings-shortcuts-and-desktop-integration`: the application close
  confirmation offers keeping or ending terminals; Restart to update skips it.
- `daemon-cli`: service restart and upgrade keep terminal sessions; uninstall
  ends them.

## Impact

- **New process and protocol**: a session holder entry point shipped in both
  the Desktop bundle and the standalone archive, speaking a small versioned
  protocol over an owner-only Unix socket in the data root.
- **`packages/server-core`**: `terminalService` gains an adopt path beside
  spawn and a detach-without-kill shutdown; `workspaceStartup` and
  `WorkspaceStore` reconcile against live holder sessions instead of
  unconditionally discarding terminal state; replay is rebuilt from the holder.
- **`electron/`**: `main.ts` quit flow and close confirmation,
  `serverTerminalAuthority.ts` factory wiring, `appUpdater.ts` restart path,
  packaging of the holder entry point (`electron-builder.json5`).
- **`apps/terminay-server`, `apps/terminay-cli`**: factory wiring in `cli.ts`,
  the systemd unit's kill mode, `upgrade` and `uninstall` commands, archive
  contents.
- **`src/`**: ended-session notice on a terminal panel; the new setting.
- **Data at rest**: a bounded tail of terminal output is written to the data
  root for sessions that end while unattached. Terminal output is otherwise
  never written to disk outside recordings.
- **Decisions**: supersedes ADR-0004's "one supervised child per PTY" topology.
- **Active change `desktop-auto-update`**: its "Restart to update" scenario
  says the quit path's confirmation applies; this change removes that
  confirmation for update restarts.
