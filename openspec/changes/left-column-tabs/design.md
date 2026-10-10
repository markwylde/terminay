## Context

`left-column-agents-pane` made a project's left column a `SidebarPanelStack` of two panes, Folders and Agents, under an untitled chrome band that holds the Folders actions button. It stores the stack's order, heights, and collapse flags per device and project as `settings.sidebar.projectFoldersColumnLayout`. It left an Agents group in the right sidebar for layouts at or below 720px, where the left column does not exist. That change is implemented and merged; its deltas are not yet folded into the main specs.

The right sidebar is a `SidebarGroupTabs` icon bar over one `SidebarPanelStack`. Its selected group is a device preference, `settings.sidebar.projectActiveGroup`.

The Folders tree is built by `buildFolderTree` in `folderTreeModel.ts`, which walks each folder's panels in the server's workspace projection and keeps the terminals as `FolderTreeTerminalRow`s. The projection holds a project's terminals; a file or folder tab is part of its folder's stored layout and is known to the renderer through the workspace inventory, which every mounted folder workspace reports and which the dashboard and the compact switcher already read. The inventory gives each panel its `WorkspaceInventoryPanelKind` (`terminal`, `file`, `folder`), folder, and title. A documentation file opened as a tab is a `file` panel.

At or below 640px the chrome collapses and the compact switcher is how a user reaches projects, folders, and terminals.

Mark's decisions for this change: one list at a time behind two icons, Tabs and Agents; no title rows; no count badge on the Agents icon; the first list is named Tabs; the actions button only on the Tabs tab; no Agents group in the right sidebar at any width, because the left column holds project-wide lists and the right sidebar holds lists scoped to the folder in front; the compact switcher gets the two tabs instead; and, added while this was being proposed, the Tabs list shows every open tab rather than only terminals.

## Goals / Non-Goals

**Goals:**

- The left column shows Tabs or Agents, full height, chosen by icon tabs that match the right sidebar's.
- The Tabs list shows every panel of every folder.
- The right sidebar holds only folder-scoped groups.
- Agents stay reachable on a phone, through the compact switcher.

**Non-Goals:**

- Changing what the Agents pane lists, or how a row activates.
- Adding a panel kind, a create row for files, or a menu, rename, or move between folders for file and folder tabs.
- Renaming folders. Only the list that holds them is called Tabs.
- Changing the workspace schema, a protocol command, or anything the server stores.
- Redesigning the compact switcher's Tabs content, which `compact-switcher-project-cards` owns.
- Changing either breakpoint.

## Decisions

### One icon tab bar component for all three places

`SidebarGroupTabs` is typed to `SidebarGroupId` and reads its icons and labels from module constants. It becomes a generic tab list that takes `tabs: { id, label, icon }[]`, the active id, an id prefix, and an accessible name. The right sidebar, the left column, and the compact switcher each pass their own tabs. The roving tabindex, arrow-key handling, and `sidebar-group-tab` styles then have one implementation, which is what makes the left icons match the right ones.

Alternative considered: a second tab bar in `FoldersColumn`. Rejected; the request is that the two sides be the same, and a copy drifts.

### The left column stops using `SidebarPanelStack`

`FoldersColumn` renders the tab bar in its band and both lists beneath it, each a `role="tabpanel"`, with the one that is not selected hidden rather than unmounted. Keeping both mounted is what preserves scroll position and row expansion across a switch without lifting that state. A one-pane stack was considered so the code path stayed shared; it was rejected because the stack's whole job is titles, minima, and separators, none of which exist here.

### The selected tab is a device preference; the stored pane layout is dropped

`settings.sidebar.projectFoldersColumnTab[server:project]` holds `'tabs' | 'agents'`, read and written through accessors in `projectTabModel.ts` beside the column's width and visibility, the same shape `projectActiveGroup` has for the right sidebar. `projectFoldersColumnLayout`, its normaliser, its accessors, and `FoldersColumnLayout` are removed; a stored value is ignored on read. `defaultAgentsPaneHeight` and its **Default Agents pane height** field in Settings are removed with them: nothing draws the Agents pane at a height of its own. Workspace state still requires a `sidebarAgentsHeight` for a new project, which is seeded with a constant.

Boundary crossed: none. This is one more device setting written through the path the renderer already uses. It grants no authority, and an unknown stored value reads as `tabs`.

Alternative considered: one shared key for both sidebars' selections. Rejected; the two selections are independent and have different value sets.

### The `agents` sidebar group is removed in the renderer only

`SIDEBAR_GROUP_IDS` becomes `['explorer', 'documentation']`, and `resolveVisibleSidebarGroup` and the narrow-layout branch in `App.tsx` go. The existing normaliser for `projectActiveGroup` already discards an id that is not a group, so a device that stored `agents` reads Explorer.

`agents` stays a member of the server's `sidebarPanelOrder`, and `sidebarAgentsHeight` and `isAgentsPaneCollapsed` stay in workspace state. The validators on the server, in `client-core`, and in the renderer all require exactly four pane ids; removing one is a schema bump and a migration to delete three unused fields. `panelsInSidebarGroup` already filters the order by group, so the fourth id is never drawn.

Boundary crossed: none. Canonical workspace state is untouched.

### The compact switcher gets a tab bar above its content

The switcher sheet draws the shared tab bar, with labels beside the icons since a phone has the width, above either its existing content or the Agents pane's content for the project in front. `App.tsx` already builds that content once; it hands it to the left column or to the switcher, and no longer to the sidebar drawer. The selected tab is component state that starts at Tabs on every open: the switcher is a transient sheet whose main job is switching terminals, and opening it onto a remembered Agents tab would put that job one tap further away.

An agent row's activation is wrapped so the switcher also dismisses, matching what a panel row does.

Alternative considered: list every project's agents in the switcher, since its Tabs content spans projects. Rejected; the Agents pane is defined per project, and a cross-project agent list is the dashboard's and the notifications list's job.

### One row type for every panel kind

`FolderTreePanelRow` is a union of `FolderTreeTerminalRow`, which gains `kind: 'terminal'`, and a row for a file or folder tab that carries only `kind`, `panelId`, `title`, and `isActive`; `FolderTreeFolderRow.terminals` becomes `panels`. `buildFolderTree` stops filtering by kind, and takes the file and folder tabs the projection does not list from the inventory (`openViewersFromInventory`), placing each after the tab it follows in its folder while the terminals keep the server's order. A row's title is the inventory's, which is read off the tab, so a row and its tab cannot disagree. The inventory was republished when a terminal's tab closed and not when a file or folder tab did, which left a closed tab listed; `useDockviewPanelLifecycle` now republishes for both. `TerminalRow` becomes `PanelRow`: a non-terminal draws a kind icon where the status indicator sits. Selection is keyed by folder id and panel id and already activates any panel, so `onSelectTerminal` becomes `onSelectPanel`.

### A row offers what its tab offers

A terminal row's menu is its tab's own menu, opened by dispatching a context-menu event at the tab; its drag reuses the tab drag that ends in a move between folders. `FileTab` and `FolderTab` have no context menu, and the renderer's move between folders is built on a terminal's session: only a terminal tab reports a drag, and the hand-over between two folders' workspaces relocates a terminal presentation. So a file or folder tab's row gets no menu, rename, or drag, and `onTerminalMenu`, `onRenameTerminal`, `onTerminalDrag`, and `onDropTerminal` keep their names.

Alternative considered: give file and folder tabs a menu and a move between folders here, so every row could offer them. Rejected for this change; the server's `panel.moveToFolder` takes any panel, but presenting a moved file tab in another folder's workspace is new renderer work that belongs with giving those tabs the same affordances, not with listing them.

`isEmpty` on a folder row already means "holds no panel of any kind", so the placeholder and the selected-folder tint follow it instead of `terminals.length`.

Alternative considered: a second list of "other tabs" under each folder's terminals. Rejected; it breaks panel order and disagrees with the compact switcher, which lists one ordered run.

Boundary crossed: none. The tree reads the workspace snapshot the renderer already holds and issues the activate, close, and move commands a tab already issues.

### Collapsing is a device preference, and the grip gives way to it

Which folders are collapsed is `settings.sidebar.projectFoldersCollapsed[server:project]`, a list of folder ids, with the same optimistic local copy the column's width and tab use. It is presentation: collapsing closes no panel and changes nothing the server holds. A stored id that names no folder is harmless and is dropped the next time the list is written.

The collapse control takes the grip's place at the leading end of the title line, where a tree's disclosure is expected, and is a chevron rather than a plus and minus: the card already ends in a plus for New terminal, and the tree in one for New folder, so a plus on the title would read as "add". With the grip gone the title line is the drag handle. `FolderCard` listens for the press and hands it to the reorder only once the pointer has travelled `CARD_DRAG_START_PX` (6px); until then nothing is prevented, so a press that stays put is the click that selects the folder, as it always was. A press on a button of the title line is ignored, and a touch is left to scroll the tree. Keyboard moves go from the grip's bare arrows to Alt with an arrow on the title row, which leaves Left and Right for collapsing, the keys a tree uses for it.

The one status a collapsed folder shows is `folderAttentionState`: the most urgent state among its terminals in the order the dashboard and the activity badge already use, and nothing when all are idle.

Alternative considered: toggle on a click of the title. Rejected; a click on the title selects the folder, and a folder with no panels can be selected no other way.

Boundary crossed: none. One more device setting through the path the renderer already uses.

### Naming

The column's first tab, its tooltip, and its accessible name are "Tabs"; the actions control is "Tabs actions". The Folders tree keeps `aria-label="Folders"` on its tree role inside the Tabs tab panel, because what it lists are folders. Component and CSS names (`FoldersColumn`, `folders-column`) are internal and stay.

### Order of archiving

This change's `project-sidebar-layout` and `agent-status-and-sidebar` deltas are written against the specs as they read once `left-column-agents-pane` has archived: they modify "Left column chrome band" and remove "Left column pane stack" and "Left column layout is a device preference", which that change adds. `left-column-agents-pane` therefore archives first. `one-window-one-server` renames "Agents pane presentation", and `compact-switcher-project-cards` rewrites the switcher's requirements; this change adds one new switcher requirement and does not modify theirs, so only the Agents pane delta needs moving onto the renamed requirement if that rename lands first.

"The Folders tree" in `project-folders` is rewritten by three unarchived changes and says the tree lists a folder's terminals. This change adds a separate requirement, "The Folders tree lists every panel", rather than a fourth rewrite of the same block. Once those three have archived, the word "terminals" in "The Folders tree" and its scenarios is brought into line with it before this change archives.

## Risks / Trade-offs

- Between 641px and 720px there is neither a left column nor a compact switcher, so the Agents pane has no home → that band already has no Folders tree; header notifications and the dashboard still present agents there. See Open Questions.
- A user can no longer see folders and agents at once → that is the request; the status dots on terminal rows and the header notifications still show agent state while Tabs is selected.
- With no count on the Agents icon, new agent activity is not visible from the Tabs tab's band → terminal rows carry their own activity indicators, and notifications cover attention states.
- A folder this device has not shown since it loaded has no mounted workspace, so its file and folder tabs are in no inventory and the tree lists only its terminals until it is shown → the compact switcher has the same limit, so the two agree; the terminals, which are what run unattended, are always listed.
- A folder with many open files makes its card long and pushes other folders down → the list scrolls, and it now fills the whole column.
- A card can no longer be reordered by touch, since a finger on its title scrolls the tree → the left column is a wide-layout surface, where a pointer or the keyboard is at hand; a touch handle can be added if it is missed.
- Stored pane heights and collapse choices are discarded → they have no meaning in a tabbed column.
- Tests locate Agents through the stack's title row and the drawer's Agents tab → the shared `selectSidebarGroup(page, 'agents')` helper is repointed once, to the left column's tab.

## Migration Plan

Renderer-only. A device upgrades by reading settings: an unknown `projectFoldersColumnLayout` key is dropped by normalisation and every project starts on Tabs. Rolling back restores the stack with default heights. Nothing on the server changes in either direction.

## Open Questions

- Should the left column stay visible down to 640px, so there is no width at which neither it nor the compact switcher exists? It would close the gap above for both Folders and Agents, and is a breakpoint change outside this proposal.
