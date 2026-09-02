# file-explorer-and-folder-tabs Specification

## Purpose

Expose each project's root folder in a resizable Files pane in the Explorer
sidebar group and open directories as dockable Folder tabs, with all listing,
search, mutation, watching, preview classification, and Markdown task
aggregation authorized and executed by Terminay Server on the exact project's
environment.

## Requirements

### Requirement: Explorer pane and project root presentation

The Explorer SHALL watch the project root and SHALL support refresh,
collapse/expand, configurable default visibility and width, and Git new/modified
decoration. Files and Git SHALL share the Explorer sidebar group; Documentation
and Agents SHALL occupy their own groups.

#### Scenario: Explorer shows the project root

- **WHEN** a project with a valid root is open
- **THEN** the Explorer presents that root's tree with refresh and
  collapse/expand controls
- **AND** entries carry Git new/modified decoration

#### Scenario: Configured default visibility and width apply

- **WHEN** the Explorer is first shown for a project
- **THEN** it opens at its configured default visibility and width

### Requirement: Watch-driven refresh of tree and Git decoration

A server-owned filesystem watch event SHALL refresh both the affected directory
and its Git decorations. External edits MUST NOT wait for the slower Git status
reconciliation poll. Watch updates SHALL cope with atomic saves, rename and
delete events, and temporarily unavailable paths.

#### Scenario: External edit updates decorations immediately

- **WHEN** a file is changed outside Terminay and the server publishes a watch
  event for it
- **THEN** the affected directory listing and its Git decorations both refresh
  from that same delivery

#### Scenario: Atomic save is not mistaken for deletion

- **WHEN** an editor writes a file through a rename-based atomic save
- **THEN** the Explorer reflects the updated file rather than a removed entry

#### Scenario: External change preserves unrelated state

- **WHEN** a file changes externally while an unrelated entry is selected
- **THEN** the change becomes visible without losing that selection and without
  opening a duplicate tab

### Requirement: Explorer entry actions

Users SHALL be able to open files and folders, drag them to the tab area,
create, rename, and delete entries, copy paths, and set a project root from a
terminal working directory. The set-root shortcut SHALL use the selected
project's environment: a This-server working directory is validated on that
host, and an SSH or Puzed working directory is validated on that remote
filesystem. A remote path MUST NOT be treated as a missing local folder.

#### Scenario: Set root from a remote terminal cwd

- **WHEN** the user sets the project root from the working directory of a
  terminal in an SSH or Puzed project
- **THEN** the path is validated on that remote filesystem
- **AND** it is never reported as a missing local folder

#### Scenario: Drag a file to the tab area

- **WHEN** the user drags an Explorer entry onto the tab area
- **THEN** that file or folder opens as a tab

### Requirement: Reveal in OS requires an opaque reveal token

**Reveal in OS** SHALL be shown only when the selected server issues an opaque
reveal token and the client host advertises the matching native capability. A
canonical or absolute server path MUST NOT be sent to the client host as a
reveal request.

#### Scenario: No reveal token available

- **WHEN** the server issues no reveal token for a selection, or the client host
  advertises no matching native capability
- **THEN** file, folder, and task-row menus omit **Reveal in OS**
- **AND** no raw-path host bridge fallback is offered

#### Scenario: Reveal with a token

- **WHEN** the server issues an opaque reveal token and the host advertises the
  capability
- **THEN** the menu offers **Reveal in OS** and the client passes only that
  opaque token to the host

### Requirement: Server-side path scoping for filesystem operations

Filesystem operations SHALL execute in Terminay Server and SHALL validate the
requested path against the intended project and root scope. Navigation SHALL
remain scoped to the selected project root and MUST NOT grant the renderer
arbitrary filesystem access.

#### Scenario: Out-of-scope path is rejected

- **WHEN** a client requests a path outside the intended project root scope
- **THEN** the server rejects the request before touching the filesystem

#### Scenario: Renderer holds no filesystem authority

- **WHEN** the client renders listing, search, or mutation results
- **THEN** it does so through the application protocol and uses no browser or
  Electron filesystem authority

### Requirement: Root reconciliation uses the hydrated server root

While a project root update is reconciling into the renderer, Explorer path
calculations SHALL use the latest hydrated server root. A stale client root MUST
NOT be relativized into a traversal request against the new server root.

#### Scenario: Root change in flight

- **WHEN** a project root update has not yet reconciled into the renderer
- **THEN** Explorer path calculations use the latest hydrated server root
- **AND** no traversal request derived from the stale root is issued

### Requirement: Bounded typed Explorer failures

When a filesystem query fails, the server SHALL return a bounded typed protocol
error rather than a generic dispatcher failure. The Explorer SHALL keep its last
successful tree while a refresh fails, and SHALL clear its own visible failure
once a later refresh succeeds. An unrelated feature failure SHALL remain
visible.

#### Scenario: Distinguishable failure causes

- **WHEN** a missing project binding, vanished folder, rejected path, or
  unexpected directory-read failure occurs
- **THEN** each produces a distinguishable bounded Explorer failure
- **AND** none renders only `query failed`

#### Scenario: Failed refresh followed by a successful refresh

- **WHEN** an Explorer refresh fails and a later refresh succeeds
- **THEN** the tree is retained throughout the failure
- **AND** only the stale Explorer failure notice is removed

#### Scenario: Missing watch capability does not block listing

- **WHEN** the environment does not provide `files.watch.*`
- **THEN** the missing capability neither occupies the Explorer failure banner
  nor blocks directory listing

### Requirement: Folder tab presentations

Folder tabs SHALL offer tree, list, thumbnail, and gallery presentations with
navigation, sorting, metadata, and image-aware previews.

#### Scenario: Switching presentation mode

- **WHEN** the user selects the thumbnail or gallery presentation in a Folder
  tab
- **THEN** the directory is presented in that mode with image-aware previews

#### Scenario: Sorting and metadata

- **WHEN** the user sorts a Folder tab
- **THEN** entries reorder and continue to show their metadata

### Requirement: Markdown task surfaces

Markdown tasks SHALL be available both for one file and recursively for a
folder. The task surfaces SHALL parse checkboxes, expose progress, filter,
search, and grouping views, and SHALL honour the configured ignored-directory
patterns.

#### Scenario: Folder task view

- **WHEN** the user opens Markdown tasks for a folder
- **THEN** tasks are aggregated recursively with progress, filter, search, and
  grouping views
- **AND** configured ignored directories are excluded

#### Scenario: Single-file task view

- **WHEN** the user opens Markdown tasks for one file
- **THEN** its checkbox tasks and progress are presented

### Requirement: Project-owned sidebar presentation state

Every project SHALL own its sidebar width, pane ordering, collapse state,
dimensions, and supported pane navigation state. This presentation state SHALL
persist with the project in the server-owned workspace and MUST NOT alter
project files or another project's sidebar. Sidebar visibility SHALL be a
device-local preference keyed by the selected server and project.

#### Scenario: Sidebar width persists with the project

- **WHEN** the user resizes a project's sidebar and reconnects from another
  client
- **THEN** that project's sidebar width, pane ordering, and collapse state are
  restored from server-owned workspace state

#### Scenario: Visibility stays device-local

- **WHEN** the user opens or closes Explorer on one device
- **THEN** another device's presentation for the same server and project is
  unchanged

### Requirement: Environment-routed filesystem ownership

Filesystem listing, search, mutation, watch, and folder-task aggregation SHALL
run on the exact project's environment adapter, authorized and routed by
Terminay Server. Canonical paths and roots SHALL be interpreted only by that
environment. A provider without filesystem observation SHALL present manual
refresh or unavailable observation and MUST NOT watch the same path on the
Terminay Server.

#### Scenario: Provider lacks filesystem observation

- **WHEN** a project's environment provides no filesystem observation capability
- **THEN** the Explorer presents manual refresh or an unavailable-observation
  state
- **AND** the Terminay Server does not watch the same path as a substitute

#### Scenario: Disconnect preserves state

- **WHEN** the environment disconnects
- **THEN** project state and dirty drafts are preserved
- **AND** ambiguous remote mutations are not blindly retried

### Requirement: Bounded directory catalog, search, and size traversal

The server catalog SHALL expose project-relative bounded directory pages,
filename search, non-following folder-size traversal, and create, rename, and
delete commands. Ordinary files and directories MAY reuse the environment
adapter's contained listing metadata so a remote tree does not re-stat every
child. Symlink children SHALL still be canonicalized; escaped symlinks SHALL be
reported as inaccessible metadata and MUST NOT be traversed or mutated. Search
and size traversal SHALL enforce entry, depth, and byte caps, honour
ignored-directory patterns, and accept cancellation.

#### Scenario: Escaped symlink

- **WHEN** a directory contains a symlink resolving outside the project scope
- **THEN** it is reported as inaccessible metadata and is neither traversed nor
  mutated

#### Scenario: Cancelled search

- **WHEN** a filename search or folder-size traversal is cancelled
- **THEN** the traversal stops and returns without exceeding its entry, depth,
  or byte caps

### Requirement: Content-free preview metadata

The catalog SHALL expose content-free preview metadata for a canonical file. It
SHALL inspect only a bounded prefix to classify Markdown, image, PDF, text, and
binary content, report safe edit and view capabilities, and select a bounded
large-file fallback without returning file bytes.

#### Scenario: Classifying a large binary file

- **WHEN** preview metadata is requested for a large binary file
- **THEN** only a bounded prefix is inspected, the file is classified as binary
  with a bounded large-file fallback, and no file bytes are returned

### Requirement: Bounded recursive Markdown task aggregation

Recursive Markdown task aggregation SHALL be server-owned. It SHALL canonicalize
each project-relative child before reading, skip configured ignored directories
and symlinks, parse checkbox tasks outside fenced code, and return heading and
file metadata with deterministic progress statistics. Traversal, decoded bytes,
files, labels, and task output SHALL be bounded; ranged reads SHALL be
sequential and cancellable. The application protocol SHALL carry the complete
bounded aggregate outside the small JSON envelope, so normal folder task views
are not capped to a preview-sized partial result. Only an explicit traversal,
byte, file, label, task, or cancellation bound MAY mark the result partial.

#### Scenario: Checkboxes inside fenced code are ignored

- **WHEN** a Markdown file contains a checkbox line inside a fenced code block
- **THEN** it is not parsed as a task

#### Scenario: Normal folder aggregate is complete

- **WHEN** a folder task view is aggregated within all bounds
- **THEN** the complete aggregate is delivered outside the small JSON envelope
  and is not marked partial

#### Scenario: Bound reached

- **WHEN** a traversal, byte, file, label, task, or cancellation bound is reached
- **THEN** the result is marked partial and remains responsive

### Requirement: Server-owned watch delivery

A watch subscription SHALL be keyed by the server, project, canonical
project-relative resource, and client subscription, and MUST NOT be keyed by an
Electron `webContentsId`. Host filesystem adapters SHALL publish small metadata
and revision facts, while clients fetch content through the bounded file-session
read contract. The server SHALL deduplicate repeated watcher facts, paginate
event batches, cancel subscriptions when their client disconnects, and collapse
an overflowing queue to an explicit resync event. After a resync, the client
SHALL request a fresh bounded tree or file snapshot before applying later
events.

#### Scenario: Client disconnects

- **WHEN** a subscribing client disconnects
- **THEN** its watch subscriptions are cancelled

#### Scenario: Watch queue overflows

- **WHEN** a watch queue overflows
- **THEN** the server collapses it to an explicit resync event
- **AND** the client requests a fresh bounded snapshot before applying later
  events

#### Scenario: Repeated watcher facts

- **WHEN** an adapter reports the same watcher fact repeatedly
- **THEN** the server deduplicates it and paginates the resulting event batches
