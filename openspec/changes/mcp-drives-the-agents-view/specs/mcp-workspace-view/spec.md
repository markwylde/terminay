## ADDED Requirements

### Requirement: The agent's client

A view operation from an MCP caller SHALL be applied by exactly one client, the
**agent's client**. For a terminal caller, that SHALL be the client holding the
calling terminal's presentation lease, on the connection that holds it. For a
chat caller, it SHALL be the client connection that sent the chat's most recent
message, which the server SHALL hold in memory only and SHALL forget when that
connection closes. When no agent's client exists, or it has not attached as
able to apply view operations, a view operation SHALL fail with
`renderer_unavailable` and SHALL change nothing. No other client's view SHALL
change because of an agent's view operation.

#### Scenario: Terminal caller on one of two devices

- **WHEN** an agent in a terminal that device A presents calls `focus_tab`,
  while device B shows the same project
- **THEN** device A shows that tab in front and device B's view is unchanged

#### Scenario: Chat caller

- **WHEN** a user sends Pixel a message from one window and Pixel then calls
  `arrange_tabs`
- **THEN** that window's tabs are arranged and no other window's are

#### Scenario: No client is presenting the caller

- **WHEN** an automation terminal no client presents calls `move_tab`
- **THEN** the call fails with `renderer_unavailable` and nothing moves

### Requirement: View request relay

The server SHALL deliver a view operation as a transient
`workspace-view.request` event addressed to the agent's client and connection.
It SHALL accept the result only through a `workspace-view.respond` command from
that same connection. A client SHALL attach once per connection with
`workspace-view.attach` before it receives view requests. A reply SHALL be at
most 256 KiB. A request SHALL fail with `renderer_unavailable` when its
connection closes or no reply arrives within 10 seconds, and SHALL fail with
`cancelled` when the MCP request is cancelled. The relay SHALL retain nothing
except its pending requests and its table of attached connections.

#### Scenario: Reply from another connection

- **WHEN** a connection other than the addressed one sends
  `workspace-view.respond` for a pending request
- **THEN** it is refused and the pending request is unaffected

#### Scenario: Client closes mid-request

- **WHEN** the agent's client disconnects while a view request is pending
- **THEN** the request fails with `renderer_unavailable`

### Requirement: Scope is checked on the server, before and after

Every project, folder, tab, and terminal a view operation names SHALL be
resolved against the caller's capability scope on the server before the request
is sent. A reference outside scope SHALL fail as not found. A client's reply
SHALL be treated as untrusted data. The server SHALL validate its shape, SHALL
drop any project, folder, tab, or terminal outside the caller's scope, and SHALL
report projects only by the opaque handles `list_terminals` uses. A reply SHALL
NEVER grant or widen authority.

#### Scenario: Project-scope agent names another project's tab

- **WHEN** a project-scope agent passes `focus_tab` a tab id from another
  project
- **THEN** the call fails as not found and no request reaches any client

#### Scenario: Reply names an out-of-scope terminal

- **WHEN** a client's layout reply includes a terminal outside the caller's
  project
- **THEN** that terminal is omitted from the result the agent receives

### Requirement: Layout description

`get_layout` SHALL return the agent's client's view of one project in scope: by
default the project that client shows, else the project the caller names. A
project-scope caller SHALL only ever see its own project. The result SHALL
include:

- what the client shows: its project and folder;
- the project's folders, each with its id, name, kind, and whether it is the
  selected one;
- the shown folder's pane tree, where a split node gives its `row` or `column`
  direction and each child's `size` as a fraction of the split, and a pane
  gives its tabs in order (each with its tab id, terminal handle for a
  terminal, kind, title, and whether it is the pane's active tab);
- the focused tab.

Every view-changing tool SHALL return this description, after the change, as
`layout`.

#### Scenario: Two side-by-side terminals

- **WHEN** a folder shows two terminals side by side and an agent calls
  `get_layout`
- **THEN** the root is a `row` split of two panes, each pane has one terminal
  tab carrying its terminal handle, and both sizes sum to 1

#### Scenario: Result after a change

- **WHEN** `move_tab` succeeds
- **THEN** its result's `layout` shows the tab in its new pane

### Requirement: View tools

Terminay SHALL expose these view tools, each acting on the agent's client:

- `focus_tab` shows a tab's project and folder and brings the tab to the front.
- `move_tab` places a tab `right`, `left`, `above`, or `below` another tab's
  pane, or into that pane (`center`).
- `resize_pane` sets the width and/or height of a tab's pane as a fraction
  between 0.05 and 0.95 of the workspace.
- `arrange_tabs` arranges the shown folder's tabs, or a listed subset, as a
  `grid`, `columns`, `rows`, or a single `tabs` stack, with equal sizes.
- `focus_project` shows a project in scope.
- `select_folder` shows a folder of a project in scope.
- `open_file` opens a file viewer tab for a path inside the project's root.
- `close_tab` closes a tab as closing it by hand does, including that client's
  close protection.

A tab parameter SHALL accept a tab id from a layout or a terminal handle.
Moving, resizing, and arranging SHALL keep each terminal's mounted emulator and
attachment. `open_file` SHALL NEVER return file content. Its failure SHALL NOT
distinguish a missing file from an unreadable one.

#### Scenario: Building a 2x2 grid

- **WHEN** a folder shows four terminals as tabs of one pane and an agent calls
  `arrange_tabs` with `grid`
- **THEN** the client shows two columns of two panes, each with one of the four
  terminals, and the returned layout says so

#### Scenario: Moving a tab beside another

- **WHEN** an agent calls `move_tab` with `position: "below"`
- **THEN** the tab is in a new pane below the target's pane, and its terminal
  keeps its output and position

#### Scenario: Opening a file

- **WHEN** an agent calls `open_file` with a path inside the project root
- **THEN** a file viewer tab for it opens on the agent's client and the result
  carries the tab id and layout, not the file's content

#### Scenario: Path outside the root

- **WHEN** an agent calls `open_file` with a path outside the project root
- **THEN** the call fails and no tab opens

### Requirement: Folder tools

`create_folder` and `rename_folder` SHALL create and rename a plain folder in a
project in scope. `move_tab_to_folder` SHALL move a terminal tab to another
folder of its own project. These SHALL be workspace commands that every device
observes. A folder SHALL be accepted as a target only inside a project the
caller already reaches, and SHALL NEVER widen or narrow the caller's scope.

#### Scenario: Agent groups terminals into a folder

- **WHEN** an agent creates a folder and moves two terminals into it
- **THEN** every device shows the folder holding those two terminals

#### Scenario: Folder in an unreachable project

- **WHEN** a project-scope agent names a folder of another project
- **THEN** the call fails as not found
