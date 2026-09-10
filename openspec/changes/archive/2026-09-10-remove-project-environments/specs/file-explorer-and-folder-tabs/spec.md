## ADDED Requirements

### Requirement: Server-owned filesystem ownership

Filesystem listing, search, mutation, watch, and folder-task aggregation SHALL
run on the server that owns the project, authorized by Terminay Server.
Canonical paths and roots SHALL be interpreted only by that server, and the
Explorer MUST NOT interpret or watch a path itself.

#### Scenario: Explorer operation is server-executed

- **WHEN** the Explorer lists, searches, mutates, watches, or aggregates folder
  tasks
- **THEN** the operation runs on the server that owns the project, authorized by
  Terminay Server
- **AND** canonical paths and roots are interpreted only by that server

#### Scenario: Disconnect preserves state

- **WHEN** the connection to the server drops
- **THEN** project state and dirty drafts are preserved
- **AND** ambiguous mutations are not blindly retried

### Requirement: Explorer entry actions and project root selection

Users SHALL be able to open files and folders, drag them to the tab area,
create, rename, and delete entries, copy paths, and set a project root from a
terminal working directory. The set-root shortcut SHALL validate the working
directory on the server that owns the selected project.

#### Scenario: Set root from a terminal cwd

- **WHEN** the user sets the project root from the working directory of a
  terminal
- **THEN** the path is validated on the server that owns the selected project

#### Scenario: Drag an entry to the tab area

- **WHEN** the user drags an Explorer entry onto the tab area
- **THEN** that file or folder opens as a tab

### Requirement: Bounded typed Explorer failure reporting

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

## MODIFIED Requirements

### Requirement: Bounded directory catalog, search, and size traversal

The server catalog SHALL expose project-relative bounded directory pages,
filename search, non-following folder-size traversal, and create, rename, and
delete commands. Ordinary files and directories MAY reuse the contained listing
metadata the server already holds so a tree does not re-stat every child.
Symlink children SHALL still be canonicalized; escaped symlinks SHALL be
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

## REMOVED Requirements

### Requirement: Environment-routed filesystem ownership

**Reason:** A project's files live on the server that owns it, so there is no adapter to route to and no filesystem-observation capability that can be absent.

**Migration:** None. The surviving ownership and disconnect rules are stated by "Server-owned filesystem ownership".

### Requirement: Explorer entry actions

**Reason:** The set-root shortcut had to choose between validating a path on the server host and validating it on another machine; a project root is always a path on the server that owns the project.

**Migration:** None. The surviving entry actions and set-root validation are stated by "Explorer entry actions and project root selection".

### Requirement: Bounded typed Explorer failures

**Reason:** Its watch-capability scenario described an Explorer whose filesystem observation could be absent; the server always provides `files.watch.*` for the projects it owns.

**Migration:** None. The surviving typed-failure, retention, and clearing rules are stated by "Bounded typed Explorer failure reporting".
