# File explorer and folder tabs

## Summary

Each project can expose its root folder in a resizable sidebar Explorer and open
directories as dockable Folder tabs. The sidebar joins the Agents and Git panes
in a persistent, reorderable vertical stack.

## Explorer

- The Explorer watches the project root, supports refresh, collapse/expand,
  configurable default visibility/width, and Git new/modified decoration.
- Users can open files/folders, drag them to the tab area, create, rename, and
  delete entries, copy paths, reveal items in the OS, and set a root from a
  terminal working directory.
- Filesystem operations execute in Terminay Server and validate the requested
  path against the intended project/root scope. Watch updates cope with atomic
  saves, rename/delete events, and temporary unavailable paths.

## Folder tabs and Markdown tasks

- Folder tabs offer tree, list, thumbnail, and gallery presentations with
  navigation, sorting, metadata, and image-aware previews.
- Markdown tasks are available both for one file and recursively for a folder.
  The task surfaces parse checkboxes, expose progress/filter/search/grouping
  views, and honour the configured ignored-directory patterns.
- Sidebar pane ordering, collapse state, and dimensions persist as local user
  preferences; they never alter project files.

## Ownership

Filesystem listing, search, mutation, watch, and folder-task aggregation run on
the selected Terminay Server under
[server-owned workspace state](./server-owned-workspace-state.md). The shared
responsive client renders results through the application protocol and never
uses browser or Electron filesystem authority. Path/project scoping,
large-content safeguards, and explicit destructive actions remain required.

## Acceptance outcomes

- File changes made externally become visible without losing an unrelated
  selection or opening a duplicate tab.
- Navigation remains scoped to the selected project root and does not grant the
  renderer arbitrary filesystem access.
- Folder task aggregation stays responsive by applying ignored-directory and
  large-content safeguards.
