## Why

A user asked Pixel to "open three more terminals and place them in a 2x2
grid". Pixel reported that it had opened them, split them, and built the
grid. On screen nothing had changed: no new terminal was visible, no split
existed, and Pixel had no way to see that.

Three faults combined:

- **Layout tools changed state no client renders.** Split geometry, pane
  sizes, and the tab in front are device-local Dockview state (terminal-workspace,
  "View state stays local to each device"). `split_terminal` and
  `focus_terminal` wrote the server's logical folder layout instead, which no
  renderer reads, and reported success. `open_terminal`'s `split` parameter was
  echoed back without doing anything on the standalone server.
- **Results did not describe what happened.** `split_terminal` returned
  `{ terminal, split }` whether or not anything moved, and its description did
  not say it opens a new terminal. Nothing let an agent read the layout back.
- **An agent cannot see the view.** No tool reports the active project, the
  tab in front, how panes are arranged, or the folders, and none moves,
  resizes, or arranges tabs, switches project, or opens a file tab.

Pixel's leftover terminals then showed the other half of the problem: four
terminals kept running in the automation space, which no project tab
presents and the Tabs section left out. A project in a workspace view that no
window shows is just as invisible. A shell found running on restart that the
workspace no longer named was ended without a trace.

## What Changes

- **View operations are carried out by the agent's own client.** A tool that
  reads or changes the view is delivered to the one client the agent is
  talking from — the client holding the calling terminal's presentation lease,
  or the client that sent the chat's latest message — which applies it to its
  Dockview and replies with the resulting layout. No client is reached: the
  tool fails with `renderer_unavailable` and changes nothing. Other devices'
  views are never touched.
- **New tools**: `get_layout`, `focus_tab`, `move_tab`, `resize_pane`,
  `arrange_tabs`, `focus_project`, `select_folder`, `create_folder`,
  `rename_folder`, `move_tab_to_folder`, `open_file`, and `close_tab`.
- **Changed tools**:
  - `split_terminal` opens exactly one new terminal beside the target on the
    agent's client and returns it with the resulting layout; it takes `focus`
    and `name`.
  - `open_terminal` takes `focus` (default false) and places a `split`
    beside `beside` (default: the calling terminal) on the agent's client.
  - `focus_terminal` shows the terminal's project, folder, and tab on the
    agent's client.
  - Every tool that changes the view returns `layout`, the client's view after
    the change.
- MCP no longer writes the server's logical split layout or active panel.
- Pixel's instructions tell it to check `get_layout` after changing the view
  and never to report a change a tool did not confirm.
- The dead renderer control handler (`useTerminalControlController`) is
  removed.
- **No running terminal is out of sight (ADR-0071).**
  - Tabs lists the automation space's terminals, and projects of other views
    marked "not in this window". Activating one opens it there, or brings
    the project into this window.
  - On restart, a running shell the workspace does not name is recovered
    into a "Recovered terminals" project instead of being ended.

## Capabilities

### New Capabilities

- `mcp-workspace-view`: device-routed view operations for MCP callers — the
  routing target, the request/reply relay, the view tools, and their results.

### Modified Capabilities

- `mcp-server`: the tool surface lists the view tools; `open_terminal`,
  `split_terminal`, and `focus_terminal` act on the agent's client; the
  security boundary admits opening a file tab, which never returns content.
- `mcp-permissions`: the new tools join Read Terminals and Full Terminal
  Management.
- `terminal-workspace`: an agent acting for a device may change that device's
  view, and only that device's.
- `workspace-dashboard`: Tabs lists terminals outside the window's projects.
- `server-owned-workspace-state`: every running terminal has a project and a
  panel, including shells recovered on restart.

## Impact

- `packages/server-core/src/workspaceView/` — new relay (event out, command
  back), wired in `composition.ts`; agent chats record the client that sent
  each message.
- `packages/client-core/src/workspaceView.ts` — client side of the relay.
- `apps/terminay-server/src/mcp/` — view tool parsing and adapter, dispatcher,
  operation tables, stdio tool registrations, standalone terminal adapter.
- `electron/main.ts` — embedded host binds the same view adapter.
- `src/` — a view controller applying requests to the project workspaces'
  Dockview, and the removal of `useTerminalControlController`.
- `packages/server-core/src/sessionHolder/reattach.ts` — restart recovery.
- `src/workspace/elsewhereTerminals.ts`, `src/App.tsx` — Tabs lists and opens
  terminals outside the window's projects.
- Tests: server-core relay tests, MCP adapter/dispatcher/stdio tests, renderer
  unit tests for the layout model, and an E2E suite driving every view tool
  through MCP against a real window.
