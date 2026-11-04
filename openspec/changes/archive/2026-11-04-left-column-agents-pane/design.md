## Context

`WorkspaceSplitLayout` gives a project three tracks at or above 720px: a folders column on the left, the panel area, and the sidebar on the right. Below 720px there is no folders column; the sidebar is a drawer and folders are reached through the compact switcher.

The right sidebar is a `SidebarGroupTabs` bar over one `SidebarPanelStack`. The stack already owns everything this change needs: title-height minima, collapse, a solver for the boundaries, pointer and keyboard resizing with a preview and a single commit, and reorder by grip. Its only inputs are pane identity, title, collapse state and preferred height.

The left column is `FoldersColumn`: a chrome band titled "Folders" over the `FoldersTree`. Its width and visibility are device preferences in `settings.sidebar`, keyed by server and project.

The Agents pane's height and collapse state are project state on the server (`sidebarAgentsHeight`, `isAgentsPaneCollapsed`), and `agents` is a member of the stored `sidebarPanelOrder`.

## Goals / Non-Goals

**Goals:**

- Folders and Agents are two panes of one stack in the left column, behaving exactly as panes do in the right sidebar.
- The chrome band above them is unchanged apart from losing its title.
- Agents remain reachable where the left column does not exist.

**Non-Goals:**

- Changing what the Agents pane lists, how rows activate, or any agent-status behaviour.
- Giving the left column group tabs. It has one stack.
- Changing the workspace schema or any protocol command.
- Moving Files, Changes or Documentation.

## Decisions

### Reuse `SidebarPanelStack` unchanged

`FoldersColumn` renders a `SidebarPanelStack` with up to two items. Nothing is forked or parameterised, so the left stack cannot drift from the right one's gesture, solver or accessibility rules. The layout controller boundary in `project-sidebar-layout` holds: the stack still knows only identity, title geometry, expansion and preferred size.

Alternative considered: a bespoke two-pane splitter in the column. Rejected; it would be a second implementation of the same contract.

### The left column's layout is a device preference

Order, the two heights and the two collapse flags are stored as `settings.sidebar.projectFoldersColumnLayout[server:project]`, beside `projectFoldersWidth` and `projectFoldersVisibility`. The whole of the left column's shape then has one owner, and a resize commits once, to one place.

Alternatives considered:

- Add a `folders` pane to the server's sidebar state. This needs a new member in `sidebarPanelOrder`, whose validators on the server, in `client-core` and in the renderer all require exactly four ids, so it is a workspace schema bump and a migration for a pane arrangement. Rejected as out of proportion.
- Keep the Agents pane on its project fields and store only the Folders pane on the device. One drag would then write to two authorities and the two halves could disagree across devices. Rejected.

Boundary crossed: none. The preference is device settings the renderer already writes; it grants no authority and is validated on read (heights clamped to 30–2000, order rebuilt from the known pane ids so a stored value can never drop a pane).

### The project's Agents fields keep serving the narrow drawer

Below 720px the sidebar drawer offers Agents as a third group, drawn from the same content and still using the project's `sidebarAgentsHeight` and `isAgentsPaneCollapsed`. Nothing is removed from workspace state, and a stored group selection of `agents` on a wide layout resolves to Explorer without being rewritten, which is the rule the disabled-integration case already follows.

Alternative considered: drop the Agents group everywhere. Rejected: a phone would lose the pane, since it has no left column.

### The band keeps the Folders actions button

The button opens the menu of what is done to the folders as a list. It stays where it is, at the trailing end of the band, so the band is unchanged but for the missing word.

## Risks / Trade-offs

- A user's stored Agents pane height and collapse choice do not carry over to the left column on a wide layout → the column starts from the default Agents height setting and expanded, and one drag sets it.
- A device that hides the left column hides Agents with it → the column's toggle in the project bar brings both back, and the header notifications and dashboard still present agents.
- The Folders tree scrolls itself, and a pane body also scrolls → the Folders pane's body is made a non-scrolling flex container so there is one scrollbar.
