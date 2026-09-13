## MODIFIED Requirements

### Requirement: Bounded directory catalog, search, and size traversal

The server catalog SHALL expose project-relative bounded directory pages,
filename search, non-following folder-size traversal, and create, rename, and
delete commands. Ordinary files and directories MAY reuse the contained listing
metadata the server already holds so a tree does not re-stat every child.
Symlink children SHALL still be canonicalized; an accessible symlink SHALL
report the kind it resolves to, so a link to a directory is presented as a
folder, and escaped symlinks SHALL be reported as inaccessible metadata and MUST
NOT be traversed. A symlink MUST NOT be renamed or written through. Deleting a
symlink SHALL remove the link itself and MUST NOT follow or remove its target;
the link SHALL be addressed through its canonicalized parent so a path whose
parent chain leaves the project is still rejected. Search and size traversal
SHALL enforce entry, depth, and byte caps, honour ignored-directory patterns,
and accept cancellation.

#### Scenario: Escaped symlink

- **WHEN** a directory contains a symlink resolving outside the project scope
- **THEN** it is reported as inaccessible metadata and is not traversed

#### Scenario: Symlink to a directory

- **WHEN** a directory contains an accessible symlink to a directory
- **THEN** the entry reports the directory it resolves to and is presented as a
  folder

#### Scenario: Deleting a symlink

- **WHEN** a symlink inside the project is deleted, including one pointing
  outside it
- **THEN** the link is removed and its target is left intact

#### Scenario: Deleting through an escaping parent

- **WHEN** a delete names a path whose parent chain resolves outside the project
- **THEN** the server rejects it before touching the filesystem

#### Scenario: Cancelled search

- **WHEN** a filename search or folder-size traversal is cancelled
- **THEN** the traversal stops and returns without exceeding its entry, depth,
  or byte caps
