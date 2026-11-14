## Why

`daemon-restart-keeps-terminals-usable` marks a kept terminal whose temporary
directory is gone and tells the user that new terminals are not affected. The
only way to recover that terminal is to close its panel and open another, which
loses its place in the layout, its name, its project and folder, and any
workflow attached to it. A **Restart terminal** action should replace the
shell behind the panel and keep everything else.

## What Changes

- A **Restart terminal** action on a terminal panel, and on the degraded
  banner, that ends the session's shell and starts a new one in the same panel,
  with the same name, project, folder, working directory and shell profile.
- **Authorization as both close and open.** A caller may restart a terminal
  only if it may close that terminal and may open one in its project. This
  applies to the desktop, remote clients and MCP alike, so restart cannot be
  used to escape the project/window or terminal-session boundaries.
- **Serialization.** Restarts of one terminal are serialized with each other
  and with close, move-to-project and handoff. A second restart while one is in
  progress joins it; a close during a restart wins and the restart reports it.
- **Expected panel binding.** The request names the session it expects the
  panel to hold. If the panel now holds another session, the restart is refused
  rather than ending the wrong shell.
- **Failure cleanup.** If the new shell cannot start, the old one is not
  resurrected: the panel shows the start failure with a retry, the old
  session's record is removed, and no half-bound session is left behind.
- The new session is started by a healthy session holder, so a restart is
  never served by the holder that was drained.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `persistent-terminal-sessions`: a kept terminal can be restarted in place,
  with the authorization, serialization, binding and cleanup rules above. This
  capability's main spec is created when `terminals-survive-restart` is
  archived, which must happen first.
- `terminal-workspace`: the panel and the degraded banner offer **Restart
  terminal**.
- `mcp-server`: a `restart_terminal` tool, authorized as close plus
  open.

## Impact

- `packages/server-core` terminal service and session holder factory:
  restart operation, per-session serialization, binding check.
- `packages/protocol` and `packages/client-core`: a `terminal.restart` request
  and its result.
- `src/components/TerminalPanel.tsx` and the degraded banner: the action.
- MCP tool list and its authorization tests.
- E2E: restart a degraded terminal and see it keep its panel, name and project
  with a working `/tmp`.
