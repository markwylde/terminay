## Context

The server owns workspace facts: projects, folders, panels, terminal sessions.
Each device owns its view: which project and folder is shown, which tab is in
front, how panes are split and sized (terminal-workspace, "View state stays
local to each device"). The renderer holds that view in one Dockview per
project folder and never reads the server's logical `folder.layout`.

MCP runs on the server. Its layout tools wrote `panel.split` and
`panel.activate` into the server's model, which no client renders. They
returned success anyway, so an agent had no signal that nothing happened.

The protocol has no server-initiated request. Every server-to-client round trip
is an addressed transient event answered by an ordinary client command
(app-window mirror `wanted` → `mirror.publish`). A transient event carrying
`clientId` (and optionally `toConnectionId`) reaches only that client
(`connection.ts` `matchesEvent`).

The server already knows which client presents a terminal:
`presentationHolder({ projectId, sessionId })` returns the lease holder's
`clientId` and `connectionId`. Agent chats record no client.

## Goals / Non-Goals

**Goals:**

- An agent can read and change the view of the client it is talking from, and
  every result states what that client actually shows afterwards.
- No view tool reports success unless the client applied it.
- Embedded Desktop and the standalone server behave identically.

**Non-Goals:**

- Syncing layout between devices, or making the server's logical layout
  authoritative.
- Changing another device's view, or the view of a client the agent is not
  talking from.
- Reading file contents, project roots, or anything else the MCP security
  boundary excludes.
- Creating, closing, or reordering projects over MCP.

## Decisions

### 1. The view target is the agent's own client

- **Terminal caller**: the client holding the calling terminal's presentation
  lease, on the connection that holds it.
- **Chat caller**: the client and connection that sent the chat's latest
  message. `agent-chat.send` records it on the in-memory chat record; it is
  never persisted and is forgotten when that connection closes.
- No target, or the target has no view-capable connection: the tool fails
  with `renderer_unavailable` and changes nothing.

*Boundary*: authority still comes only from the capability (mcp-server, "MCP
security and privacy boundaries"). The target client decides *where* a view
change is applied, never *whether* it is allowed or *what* it may reach. Every
reference is checked against the caller's scope on the server before the
request is sent, and the reply is filtered to that scope after.

*Alternative rejected*: make layout server-owned and synced. It reverses an
explicit product requirement, and any agent's change would move every device.

### 2. A relay of addressed events and reply commands

`packages/server-core/src/workspaceView/` owns a `WorkspaceViewRelay`:

- A client that can apply view requests sends `workspace-view.attach` once per
  connection. The relay records `connectionId → clientId`, and drops it on
  connection close, failing any pending request to it.
- `request(target, op, params, signal)` publishes a transient
  `workspace-view.request` event `{ clientId, toConnectionId, requestId, op,
  params }` and waits for the reply.
- The client answers with `workspace-view.respond { requestId, ok, result |
  error }`. Only the addressed connection may answer; a reply is bounded to
  256 KiB.
- Each request has a 10 s deadline. Cancellation, deadline, or connection loss
  rejects it with `renderer_unavailable` or `cancelled`.

The relay keeps nothing beyond pending requests and the attach table. Both
hosts get it from the shared composition.

*Boundary*: the reply comes from a renderer, which is untrusted at privileged
boundaries. It confers no authority. The server validates its shape, drops
anything outside the caller's scope, and maps ids to the handles the caller
already uses.

### 3. One view adapter, shared by both hosts

`apps/terminay-server/src/mcp/workspaceViewTools.ts` parses parameters and
`workspaceViewAdapter.ts` binds them to the relay, the workspace repository,
and the project handle codec. The dispatcher composes the terminal tools with
it:

- `split_terminal`: the host opens the terminal in the target's project and
  folder. The view adapter then places it beside the target, focusing it only
  if asked.
- `open_terminal` with `split`: the same placement beside `beside`, else beside
  the calling terminal. `focus: true` alone shows the new terminal.
- `focus_terminal`: the view adapter shows its project, folder, and tab.
- The hosts no longer apply `panel.split` or `panel.activate`.

When terminal creation succeeds and placement fails, the terminal is kept and
the result says so: `{ terminal, placed: false, reason }`. A terminal never
silently goes missing.

### 4. Tool surface and results

| Tool | Group | Does |
| --- | --- | --- |
| `get_layout` | Read Terminals | The client's view of one project (default: what it shows) |
| `focus_tab` | Full Terminal Management | Show a tab's project and folder, and bring it to front |
| `move_tab` | Full Terminal Management | Put a tab beside another (`right`/`left`/`above`/`below`) or into its group (`center`) |
| `resize_pane` | Full Terminal Management | Set a tab's pane width and/or height as a fraction of the workspace |
| `arrange_tabs` | Full Terminal Management | Arrange the shown folder's tabs as `grid`, `columns`, `rows`, or one `tabs` stack |
| `focus_project` | Full Terminal Management | Show a project in scope |
| `select_folder` | Full Terminal Management | Show a folder of a project in scope |
| `create_folder` / `rename_folder` | Full Terminal Management | Server workspace commands on a project in scope |
| `move_tab_to_folder` | Full Terminal Management | Server `panel.moveToFolder` on a terminal tab in scope |
| `open_file` | Full Terminal Management | Open a file viewer tab for a path inside the project root |
| `close_tab` | Full Terminal Management | Close any tab, as closing it by hand does |

Every view-changing result includes `layout`, the same shape `get_layout`
returns:

```
{ project?, project_title?, shown: { project?, folder },
  folders: [{ folder, name, kind, selected }],
  root: { split: "row"|"column", children: [{ size, ...node }] }
      | { pane, tabs: [{ tab, terminal?, kind, title, active }] },
  focused_tab? }
```

`project` fields are opaque project handles and appear only for workspace
reach, matching `list_terminals`. A `tab` is the client's tab id; a terminal
tab also carries its `terminal` handle. A tool's `tab` parameter accepts
either.

*Folders as inputs*: the `linked-folders` change says no MCP tool accepts a
folder as an input. This change lets a folder be a *target* inside a project
the caller already reaches; a folder never widens or narrows scope. That
change's wording is aligned to match.

*`open_file`*: the client opens the path through its normal file viewer, whose
reads the server already confines to the project root. The agent receives only
the tab id or a bounded failure, never content. A failure distinguishes
nothing finer than "could not open". An agent in a project terminal can already
probe paths in that root with its shell.

### 5. Renderer controller

`src/workspace/workspaceViewController.ts` subscribes to
`workspace-view.request` on each server connection and attaches once. It
resolves the project workspace through the existing `FolderWorkspaceRegistry`
and applies operations with the Dockview API the UI already uses:

- `moveTo` for placement, which keeps the mounted terminal, so terminal
  presentation is preserved.
- `setActive` for focus.
- `group.api.setSize` for sizes.
- The existing project activation and folder selection for showing.

`ProjectWorkspaceHandle` exposes `viewApi()` and `openFileTab()` for this. The dead
`handleControlRequest` is removed.

A pure function turns a Dockview `toJSON().grid` into the `root` tree, so the
shape is unit-tested without a DOM.

### 6. Pixel's instructions

Pixel's instruction adds: change the view only with the layout tools, check
the `layout` they return or call `get_layout`, and never say something happened
that a tool result does not show.

### 7. No running terminal is out of sight (ADR-0071)

- **Tabs** builds extra groups from the server snapshot (`elsewhereTerminals`):
  every project not presented by this window that holds a terminal, then the
  automation space. Rows open an automation terminal in the Automations
  section, or move a project of another view into this window with the
  existing `project.move`.
- **Restart** (`reattachHeldSessions`): a held shell the workspace does not
  name and that is still running gets a panel in a new "Recovered terminals"
  project in the first view, and is adopted. Ended or foreign ones are ended
  as before.

*Boundary*: recovery is the server's own startup reconciliation of PTYs it
already holds. No client input decides it, and a recovered shell gets an
ordinary project-scope placement.

## Risks / Trade-offs

- **The agent's client is closed or asleep** → the tool fails with
  `renderer_unavailable` instead of pretending. Terminals still open; only
  placement needs a client.
- **A terminal caller whose lease another device took over** → view changes
  follow the lease holder, which is the device now driving that terminal. This
  is the intended "device the agent is talking from".
- **Arranging moves panes the user was using** → only on the agent's own
  client, under Full Terminal Management, which the user can set to Ask.
- **Renderer replies are untrusted** → bounded, shape-validated, and
  scope-filtered on the server; they never grant or widen anything.
- **A restart adds a project the user did not create** → it is named for what
  it holds, and closing it ends its terminals like any project.
