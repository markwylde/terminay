# File explorer and folder tabs

## Summary

Each project can expose its root folder in a resizable sidebar Explorer and open
directories as dockable Folder tabs. Explorer joins Documentation, Agents, and
Git in a persistent, reorderable vertical stack. The focused Markdown/MDX tree
and rich editor are governed by
[Documentation sidebar and editor](./documentation-sidebar-and-editor.md).

## Explorer

- The Explorer watches the project root, supports refresh, collapse/expand,
  configurable default visibility/width, and Git new/modified decoration.
- A server-owned filesystem watch event refreshes both the affected directory
  and its Git decorations; external edits do not wait for the slower Git status
  reconciliation poll.
- Users can open files/folders, drag them to the tab area, create, rename, and
  delete entries, copy paths, and set a root from a terminal working directory.
  **Reveal in OS** is shown only when the selected server issues an opaque
  reveal token and the client host advertises the matching native capability;
  a canonical or absolute server path is never sent to the client host as a
  reveal request.
- Filesystem operations execute in Terminay Server and validate the requested
  path against the intended project/root scope. Watch updates cope with atomic
  saves, rename/delete events, and temporary unavailable paths.
- While a project root update is reconciling into the renderer, Explorer path
  calculations use the latest hydrated server root. A stale client root must
  not be relativized into a traversal request against the new server root.
- When a filesystem query fails, the server returns a bounded typed protocol
  error rather than a generic dispatcher failure. The Explorer keeps its last
  successful tree while a refresh fails, and clears its own visible failure once
  a later refresh succeeds; an unrelated feature failure remains visible.

## Folder tabs and Markdown tasks

- Folder tabs offer tree, list, thumbnail, and gallery presentations with
  navigation, sorting, metadata, and image-aware previews.
- Markdown tasks are available both for one file and recursively for a folder.
  The task surfaces parse checkboxes, expose progress/filter/search/grouping
  views, and honour the configured ignored-directory patterns.
- Every project owns its sidebar visibility, width, pane ordering, collapse
  state, dimensions, and supported pane navigation state. This presentation
  state persists with the project in the server-owned workspace and never
  alters project files or another project's sidebar.

## Ownership

Filesystem listing, search, mutation, watch, and folder-task aggregation run on
the exact project's environment adapter, authorized and routed by Terminay
Server under
[server-owned workspace state](./server-owned-workspace-state.md). The shared
responsive client renders results through the application protocol and never
uses browser or Electron filesystem authority. Path/project scoping,
large-content safeguards, and explicit destructive actions remain required.

Canonical paths and roots are interpreted only by that environment. A provider
without filesystem observation presents manual refresh/unavailable observation;
it never watches the same path on the Terminay Server. Disconnect preserves
project state and dirty drafts, and ambiguous remote mutations are not blindly
retried.

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
cancellable so a large folder cannot exhaust host resources. The application
protocol carries the complete bounded aggregate outside the small JSON envelope,
so normal folder task views are not capped to a preview-sized partial result;
only explicit traversal, byte, file, label, task, or cancellation bounds may
mark the result partial.

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
- Git decorations reflect external file changes from the same watch delivery.
- Navigation remains scoped to the selected project root and does not grant the
  renderer arbitrary filesystem access.
- File, folder, and task-row menus omit **Reveal in OS** while no opaque reveal
  token is available; they never fall back to a raw-path host bridge.
- Folder task aggregation stays responsive by applying ignored-directory and
  large-content safeguards.
- A missing project binding, vanished folder, rejected path, and unexpected
  directory-read failure produce distinguishable bounded Explorer failures;
  none render only `query failed`.
- A failed Explorer refresh followed by a successful refresh retains the tree
  during the failure and removes only the stale Explorer failure notice.
