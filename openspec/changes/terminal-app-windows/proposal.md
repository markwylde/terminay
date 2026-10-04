## Why

An agent running in a Terminay terminal can only answer in text. Chat hosts such as
Claude Desktop and ChatGPT can show interactive UI through MCP Apps, and agent CLIs
cannot, because a terminal has nowhere to put HTML. Terminay renders its terminals
in a web surface, so it can: a user should be able to ask "show me a hello world
window" or call a tool that has a UI and see a real, interactive window beside the
agent, without Terminay hooking into any agent CLI.

Two things block this today. Terminay's MCP server offers no way to show anything
but text. And an MCP App's UI is delivered to whichever program is the MCP client of
its server, which is the agent CLI, so Terminay never receives it.

## What Changes

- **App windows.** A terminal can own floating windows that show sandboxed HTML. A
  window opens at the bottom-left of its terminal's pane at its content height,
  capped at 60% of the pane, and is a bottom sheet on a narrow pane. It minimises to
  a tab attached to the pane's bottom edge; while any tab is present the terminal
  ends above a rail that holds the tabs, so no terminal text is covered. One window
  is open per terminal. Terminal and project tabs show a badge for terminals that
  have windows, which pulses when one arrived while the user was elsewhere.
- **Agent-authored windows.** New Terminay MCP tools `show_window`, `close_window`
  and `list_windows` let the agent show its own HTML, CSS and JavaScript in a window
  in the calling terminal, with open network access.
- **MCP Apps through a gateway.** Terminay connects to MCP servers the user lists in
  Settings > AI as a client that advertises the `io.modelcontextprotocol/ui`
  extension, and offers their tools to the agent through the Terminay MCP server.
  When the agent calls a tool that declares a UI, Terminay shows that UI in a window
  in the calling terminal and still returns the tool's result to the agent.
- **Windows talk back.** A window can send a message, which Terminay types into the
  owning terminal and submits, and can update context that reaches the model with
  the next tool result. An MCP App's view can also call its own server's tools.
- **Follows control.** The open view runs on the client that holds interactive
  control of the terminal, and moves when another device takes control.
- **Permissions.** Settings > AI gains three policies, all defaulting to Always
  Allow: App Windows, Connected Server Tools, and Window Messages.
- **MCP surface widens.** The MCP server's statement that it exposes terminal
  control and automation management only is replaced: it also exposes app windows
  and the tools of user-configured servers.

Nothing in this change hooks, patches, or configures an agent CLI beyond the
existing Terminay MCP registration.

## Capabilities

### New Capabilities

- `terminal-app-windows`: windows owned by a terminal — placement, minimised tabs and
  rail, badges, lifecycle, the sandboxed view and its message contract, messages
  typed into the terminal, and which client renders a view.
- `mcp-app-gateway`: user-configured upstream MCP servers, their connection
  lifecycle, exposing their tools through the Terminay MCP server, and hosting their
  MCP Apps views.

### Modified Capabilities

- `mcp-server`: adds the app-window tools; replaces the security-boundary and
  non-goal statements that limit the surface to terminal control and automations.
- `mcp-permissions`: adds the App Windows and Connected Server Tools groups and the
  Window Messages policy, and lists them in Settings > AI.

## Impact

- **Server** (`apps/terminay-server/src/mcp/`, `packages/server-core/`): new
  operations in the control endpoint and dispatcher; an upstream-connection manager
  using the MCP SDK client; a server-owned window store per terminal session; new
  permission groups; larger bounded request frames for HTML.
- **Protocol** (`packages/protocol`, `packages/client-core`): operations and events
  for window state, view resources, view-to-server requests and upstream-server
  settings, behind a new capability.
- **Workspace UI** (`src/components/TerminalPanel.tsx`, tab components, settings):
  the window layer, tab rail, badges, sandboxed view host, and the MCP servers and
  permission settings.
- **Hosts** (`electron/`, `apps/terminay-server/src/localUiServer.ts`,
  `packages/ui-bundle`): a dedicated view origin and the content-security-policy
  change that allows framing it.
- **Secrets**: upstream server credentials are held in the server vault.
- **Dependencies**: none new; the upstream client is the already-present
  `@modelcontextprotocol/sdk`.
- **Evidence**: the prototype in `scripts/spikes/mcp-apps/` and its write-up.
