## Why

A project's left column holds its folders and their terminals, and the agents working in those terminals are listed on the other side of the window, behind a third sidebar tab. To see which agent is running where, a user opens the right sidebar, leaves Files and Changes, and reads a list whose rows point back at the terminals on the left. The two lists describe the same work and belong side by side.

The left column also spends a band of project chrome on the word "Folders", which says nothing once the column holds more than folders.

## What Changes

- The left column becomes a stack of two panes, **Folders** and **Agents**, with the same pane behaviour the right sidebar has: each pane collapses to its title, the boundary between them is dragged or moved from the keyboard, and the panes are reordered by their grips.
- The band of project chrome above the stack keeps its colour, height and the Folders actions button, and carries no title. Each pane names itself in its own title row.
- At or above the narrow layout breakpoint the right sidebar has two groups, Explorer and Documentation. The Agents group is offered only below the breakpoint, where there is no left column, so agents stay reachable on a narrow screen.
- The left column's pane order, pane heights and collapse choices are kept per device and project, beside the column's width and visibility.
- Turning agent integration off removes the Agents pane; Folders then fills the column.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-sidebar-layout`: which groups the sidebar offers and when the Agents group is one of them; the left column's pane stack, its untitled chrome band, and where its layout is kept.
- `agent-status-and-sidebar`: where the Agents pane is presented.

## Impact

- `src/components/folders/FoldersColumn.tsx`, `foldersTree.css`: the column draws a `SidebarPanelStack` of two panes under an untitled band.
- `src/App.tsx`: the Agents pane's content is built once and handed to the left column, or to the drawer's Agents group when narrow; the left column's layout is read from and written to device settings.
- `src/types/settings.ts`, `src/terminalSettings.ts`, `src/workspace/projectTabModel.ts`: a device-local `projectFoldersColumnLayout` preference, its normaliser and its accessors.
- `src/shared/WorkspaceSplitLayout.tsx`: exports the narrow-layout test as a hook.
- `e2e/agent-status-sidebar.spec.ts`, `e2e/project-sidebar-layout.spec.ts`, `e2e/support/ui.ts`, `src/workspace/projectTabModel.test.ts`: assertions that reach Agents through the sidebar tab reach it in the left column.
- No protocol command, server behaviour, or stored workspace state changes. The project's stored Agents pane height and collapse state keep serving the narrow drawer.
