## Context

A project workspace has two resizable columns, both drawn by `WorkspaceSplitLayout`: the Folders tree on the left (`foldersWidth`) and the project sidebar on the right (`navigationWidth`, with `navigationSide="trailing"`). Home uses the same layout for its own sidebar. Today each one stores its width differently:

- **Right sidebar.** The width is `fileExplorerWidth` in the project's server-owned sidebar state (`packages/server-core/src/workspace.ts`). It is committed through `commitProjectSidebar`, which applies the change optimistically, sends a `project.sidebar.update`, and waits for the canonical snapshot before releasing its overlay. New projects start at the `sidebar.defaultWidth` setting (280).
- **Left Folders tree.** The width is `sidebar.projectFoldersWidth[serverId:projectId]` in terminal settings, with `DEFAULT_FOLDERS_TREE_WIDTH` (232) as the fallback. Settings belong to the server and are read through `SettingsClient`, so this width is shared across devices even though the code comments call it device-local.
- **Home sidebar.** The width is a `useState(220)` in `App.tsx` and is never saved.

`src/workspace/localViewState.ts` is the module that holds device presentation state which must never travel. It already stores Home sidebar visibility, the dashboard view mode, and the Home layout in `localStorage`, writing on a best-effort basis.

Under ADR-0047, a window runs the bundle supplied by its own server, so the client and server in a window are always the same version. Removing a field from the sidebar DTO therefore needs no mixed-version tolerance on the wire.

## Goals / Non-Goals

**Goals:**

- One remembered width for the left column and one for the right, each shared by every project.
- A remembered width for the Home sidebar, separate from both.
- All three widths stay on the device, in one place, using one mechanism.
- Remove the per-project width storage on both the server and the settings side.

**Non-Goals:**

- Pane heights, pane order, and collapse state stay per project and server-owned.
- Column visibility, which is per project per device, is unchanged.
- Syncing widths between devices.

## Decisions

### 1. Widths live in `localViewState`, not in settings or the workspace

Add `rememberColumnWidth(column, width)` and `recallColumnWidth(column)` for `column` in `'folders' | 'sidebar' | 'home'`. They use one `localStorage` key (`terminay.view.column-widths.v1`) holding a small record. A missing, unreadable, or out-of-range value falls back to that column's default: 232, 280, and 220 respectively.

*Alternative: a global field in terminal settings.* Settings are server-owned (see "Server settings client boundary"), so the width would follow the server rather than stay on the device, which contradicts the owner's choice. *Alternative: server workspace state.* This is ruled out for the same reason, and the round trip only adds an optimistic-overlay protocol that a device preference does not need.

The boundary crossed: none. The widths move from server-owned state into device presentation state, which reduces what the server stores and authorizes.

### 2. One React state per column, at the top of the window

`App.tsx` holds `foldersColumnWidth`, `sidebarWidth`, and `homeSidebarWidth` in state, initialised from `recallColumnWidth`. Each project workspace receives the shared value as its controlled width, and its commit callback sets the state and calls `rememberColumnWidth`. Because every mounted project reads the same state, a resize in one project re-renders all of them. Hidden workspaces still keep their column width (the existing comment at `App.tsx:5603`), so terminals behind the active project are re-fit once when the width changes, as with any layout change.

A `storage` event listener updates the state when another window on the same origin writes a new width, so separate windows converge without a reload. The listener only reads; it never writes back.

### 3. Remove `fileExplorerWidth` from the workspace model

Remove it from `WorkspaceSidebarState`, `defaultWorkspaceSidebarState`, `normalizeWorkspaceSidebarState`, the dimension validation, and the patch allow-list in server-core. Remove it from the matching client-core types and validators, `ProjectSidebarState`, `PROJECT_SIDEBAR_KEYS`, and `serverWorkspaceReconciliation`.

`normalizeWorkspaceSidebarState` copies only known keys, so a stored workspace that still carries `fileExplorerWidth` loads and drops it on the next write without a schema bump, following the same pattern as `forgetStoredProgramTitles`. A sidebar patch that names `fileExplorerWidth` is rejected as an unknown key, and no client in the same bundle sends one.

*Alternative: bump the schema to 8 with an explicit migration.* That adds a backup and migration step for a field whose loss is harmless, and the existing loader already tolerates it.

### 4. Remove the per-project folders width and the default-width setting

Remove `projectFoldersWidth`, `projectFoldersTreeWidthOnDevice`, `withProjectFoldersTreeWidth`, `DEFAULT_FOLDERS_TREE_WIDTH`'s per-project use, the `foldersTreeChanges.width` overlay, `sidebar.defaultWidth`, and its Settings field. Settings normalization rebuilds the sidebar object from known keys, so stored values for the removed keys disappear on the next settings write.

The remembered width is not migrated from either of the old stores, because neither held a single width to carry over.

## Risks / Trade-offs

- [Each width starts at its default the first time it is used after the upgrade] → This happens once per device and costs one drag.
- [Origins on the same machine do not share `localStorage`, so a Desktop window on the Local server and a browser tab remember separately] → This is acceptable for a presentation preference, and Home visibility already behaves the same way.
- [Removing `fileExplorerWidth` from fixtures touches many tests] → Make the change mechanically and let the typecheck find the remaining references.

## Migration Plan

Nothing runs at upgrade. Old keys are ignored on read and dropped on the next write. The change is forward-only. An older server validates `fileExplorerWidth` as required, so it would reject a workspace this build has written. Rolling back therefore needs a build whose normalizer defaults the missing field, not a plain revert.

## Open Questions

None.
