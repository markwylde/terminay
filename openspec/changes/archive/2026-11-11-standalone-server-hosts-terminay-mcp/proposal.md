## Why

Connect a window to a standalone Terminay Server, such as one started with
`docker run`, and the connection menu says "Without mcp-approvals.v1,
app-windows.v1, app-window-mirror.v1, app-window-attachments.v1,
workspace-view.v1". A freshly installed server should never look degraded.
Agents in that server's terminals get no Terminay MCP at all. They cannot list
or drive sibling terminals, cannot open app windows, cannot arrange panes, and
are never asked for permission, because nothing is listening for them.

The technical reason is that the standalone server never starts the MCP
control endpoint. The endpoint, the capability store, every tool adapter, the
permission gate, and the connected-server gateway are wired inside
`electron/main.ts`. Server Core composes approvals, app windows, and workspace
view only when a host passes `mcpApprovals: true`, and only Desktop does. The
existing `mcp-server` spec already says every Terminay Server owns its MCP
surface and exposes its own socket, so the standalone server breaks the
contract.

## What Changes

- The standalone server starts the Terminay MCP control endpoint, mints a
  capability for every terminal it launches, and gives each terminal
  `TERMINAY_CONTROL_SOCKET` and `TERMINAY_CONTROL_TOKEN`, exactly as Desktop
  does.
- The MCP host wiring moves out of `electron/main.ts` into a host module in
  `apps/terminay-server`: the endpoint, capability store and its persistence,
  the terminal, automation, app-window, notification, workspace-view,
  app-control, settings, macro and workflow adapters, the permission gate, the
  connected-server gateway binding, and chat and bot capability minting. Desktop
  and the standalone server both compose that one module. Desktop keeps only
  what is truly Desktop's: paths under `userData`, the Electron-run MCP entry
  command, and launch recovery reporting.
- **BREAKING (internal API):** Server Core's `mcpApprovals` composition option
  is removed. Every server composes MCP approvals, app windows and workspace
  view, and advertises `mcp-approvals.v1`, `workspace-view.v1`,
  `app-windows.v1`, `app-window-mirror.v1` and `app-window-attachments.v1`.
  `appWindows` becomes optional configuration of an always-present service
  rather than its on switch.
- The standalone server composes connected MCP servers, with their file in the
  data root and their credentials in its vault, so MCP Apps work there too.
- The standalone server offers **Install Terminay MCP** targets. The registered
  command is the server's own Node binary with the absolute path of its
  `mcpEntry.js`, resolved from the CLI module's own location rather than the
  working directory or `PATH`. Settings for a window on that server shows and
  installs them on that server's machine.
- The standalone server gives its bots Terminay MCP the way Desktop does, by
  passing the host's bot capability minting into `createBotServerService`.
- The **Enable Terminay MCP server** switch stays, and now governs the
  standalone server as it governs Desktop.
- When the standalone server cannot place its control socket, it refuses to
  start and prints the same explanation Desktop shows in launch recovery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-server`: every server host, embedded or standalone, serves the control
  endpoint, issues terminal capabilities, and offers registration targets. The
  standalone server reports an unplaceable socket at startup.
- `mcp-permissions`: every server composes the approval service; no host may
  serve MCP without it.
- `terminal-app-windows`: every server offers app windows, their mirror and
  attachments. Negotiation stays only so that an older peer degrades safely.
- `mcp-workspace-view`: every server offers workspace view.

## Impact

- `electron/main.ts`: about 2,000 lines of MCP glue move out.
  `electron/serverTerminalAuthority.ts` loses its `mcpApprovals` flag and its
  hard-coded capability list entries for these features.
- `apps/terminay-server/src/mcp/`: new host module. `apps/terminay-server/src/cli.ts`
  composes it.
- `packages/server-core/src/composition.ts`: `mcpApprovals` option removed;
  approvals, app windows and workspace view always composed and advertised.
- Docker image: no packaging change. The image already contains
  `server/dist/mcpEntry.js`, and the registered command names it by absolute
  path with the image's Node, so no `terminay-mcp` launcher on `PATH` is needed.
- Tests: Server Core composition tests that build a server without approvals,
  and new standalone tests that start the CLI and make an MCP call from a
  terminal.
- Clients: the connection menu no longer shows "Without …" for a current
  standalone server. Against an older server it still does.
