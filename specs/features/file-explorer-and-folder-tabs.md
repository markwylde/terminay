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

The server catalog exposes project-relative, bounded directory pages, filename
search, non-following folder-size traversal, and create/rename/delete commands.
Each child is canonicalized again before metadata is returned; escaped
symlinks are reported as inaccessible metadata and are never traversed or
mutated. Search and size traversal enforce entry/depth/byte caps, honour
ignored-directory patterns, and accept cancellation.

The same catalog exposes content-free preview metadata for a canonical file.
It inspects only a bounded prefix to classify Markdown, images, PDF, text, and
binary content, reports safe edit/view capabilities, and selects a bounded
large-file fallback without returning file bytes.

Recursive Markdown task aggregation is also server-owned. It canonicalizes each
project-relative child before reading, skips configured ignored directories and
symlinks, parses checkbox tasks outside fenced code, and returns heading/file
metadata with deterministic progress statistics. Traversal, decoded bytes,
files, labels, and task output are bounded; ranged reads are sequential and
cancellable so a large folder cannot exhaust host resources.

Watch delivery is also server-owned. A watch subscription is keyed by the
server, project, canonical project-relative resource, and client subscription;
it is never keyed by an Electron `webContentsId`. Host filesystem adapters
publish small metadata/revision facts, while clients fetch content through the
bounded file-session read contract. The server deduplicates repeated watcher
facts, paginates event batches, cancels subscriptions when their client
disconnects, and collapses an overflowing queue to an explicit resync event.
After resync, the client requests a fresh bounded tree/file snapshot before
applying later events.

## Acceptance outcomes

- File changes made externally become visible without losing an unrelated
  selection or opening a duplicate tab.
- Navigation remains scoped to the selected project root and does not grant the
  renderer arbitrary filesystem access.
- Folder task aggregation stays responsive by applying ignored-directory and
  large-content safeguards.
