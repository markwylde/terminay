## Why

A project's left column stacks two panes, Folders and Agents, each under its own title row, with a separator between them. Both lists want the whole column: a project with several folders pushes its agents into a strip at the bottom, and a busy Agents list squeezes the folders. The right sidebar already solves the same problem with a row of tab icons, one group on screen at a time, so the two sides of one window behave differently for no reason a user can see.

The list on the left also shows only terminals. A project's tabs include open files, documentation, and folder tabs, and none of them appear there, so the list called Tabs would not show the tabs, and a file open in another folder cannot be found or reached from it.

The two sides also hold different kinds of thing. The left column is the project's global lists; the right sidebar is scoped to the folder in front. Agents are project-wide, yet a narrow layout still offers them as a group of the right sidebar.

## What Changes

- The left column shows one list at a time, chosen from two tab icons in its chrome band: **Tabs** and **Agents**. The icons look and behave like the right sidebar's group tabs.
- **Tabs** shows the folders tree. **Agents** shows the project's agents. Each fills the column.
- Under each folder the tree lists every tab that folder holds, in panel order: terminals, open files (documentation included), and folder tabs. A non-terminal row shows an icon for its kind in place of the status indicator, and activates and highlights as a terminal row does. A row offers what its tab offers: a terminal's row keeps its menu, rename, and drag to another folder, and a file or folder tab's row has none, because those tabs have none.
- The Folders and Agents title rows, their collapse chevrons, their reorder grips, the separator between them, and the count beside the Agents title are gone. The Agents tab icon carries no count badge.
- The first list is named **Tabs** wherever the column names it: the tab's label and tooltip, and the actions control, which becomes **Tabs actions**. Folders inside the list are still folders.
- The **Tabs actions** control is shown only while the Tabs tab is selected.
- Each folder card has a collapse control where its drag grip was. Collapsed, a card is its title line alone, with one status indicator for all of its terminals: the most urgent state among them, or none when they are all idle. Which folders are collapsed is remembered per device and project.
- A folder card is reordered by dragging its title line, once the press has travelled a few pixels; a press that barely moves is still a click that selects the folder. From the keyboard a folder moves with Alt and the Up or Down arrow, and collapses and opens with Left and Right.
- Folder cards are drawn without a border.
- The selected tab is remembered per device and project. Turning agent integration off removes the Agents tab and its icon bar, leaving the Tabs list.
- **BREAKING** The right sidebar no longer offers an Agents group at any width. It has two groups, Explorer and Documentation.
- On a compact workspace the switcher offers the same two tabs, **Tabs** and **Agents**: Tabs is the switcher's existing content, Agents lists the agents of the project in front.
- The left column's stored pane order, heights, and collapse choices are no longer read, and the **Default Agents pane height** setting, which only sized that pane, is removed from Settings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-sidebar-layout`: the left column is a tabbed column rather than a pane stack; its chrome band holds the tab icons; its selected tab replaces its pane layout as the device preference; the sidebar has two groups at every width.
- `agent-status-and-sidebar`: where the Agents pane is presented, on a wide layout and on a compact workspace.
- `workspace-and-project-tabs`: the compact switcher gains Tabs and Agents tabs.
- `project-folders`: the Folders tree lists every panel of a folder, not only its terminals; a folder collapses to its title line with one status for its terminals; a folder is carried by its title line rather than a grip.

## Impact

- `src/components/folders/FoldersColumn.tsx`, `foldersTree.css`: the column draws a tab bar in its band over one tab panel; the `SidebarPanelStack` is no longer used here.
- `src/workspace/folderTreeModel.ts`, `src/workspace/folderTreeSources.ts`, `src/components/folders/FoldersTree.tsx`: a folder row carries panel rows of every kind; the row component draws a kind icon for a non-terminal.
- `src/components/sidebar/SidebarGroupTabs.tsx`, `sidebar.css`: the icon tab bar is made reusable by the left column and the compact switcher.
- `src/components/sidebar/sidebarGroups.ts`, `src/types/settings.ts`: the `agents` sidebar group is removed.
- `src/types/settings.ts`, `src/terminalSettings.ts`, `src/workspace/projectTabModel.ts`: a device-local selected-tab preference replaces `projectFoldersColumnLayout`.
- `src/workspace/CompactSwitcher.tsx`, `src/App.css`, `src/App.tsx`: the switcher's tab bar and Agents panel; the Agents content is handed to the left column or the switcher and no longer to the sidebar drawer.
- Tests: `e2e/project-sidebar-layout.spec.ts`, `e2e/agent-status-sidebar.spec.ts`, `e2e/file-explorer-sidebar.spec.ts`, `e2e/compact-chrome-switcher.spec.ts`, `e2e/support/ui.ts`, `e2e/linked-folders.spec.ts`, `scripts/compact-switcher-ui.test.mjs`, `scripts/folder-tree-model.test.mjs`, `scripts/folders-tree-row.test.mjs`, `src/workspace/projectTabModel.test.ts`, `src/components/sidebar/sidebarGroups.test.ts`.
- No protocol command, server behaviour, or workspace schema changes. The project's stored Agents pane height, collapse flag, and `agents` entry in the sidebar pane order stay in workspace state and are not presented.
- Builds on `left-column-agents-pane`, which is implemented and not yet archived, and overlaps `compact-switcher-project-cards`, `one-window-one-server`, and the unarchived `project-folders` changes (`linked-folders`, `folders-sidebar-cards`, `worktree-folder-single-line`). design.md says how the deltas are reconciled.
