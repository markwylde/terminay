## ADDED Requirements

### Requirement: Per-operation canonical project root

A filesystem operation SHALL canonicalize the project root once and resolve
every path it handles against that one canonical root. It MUST NOT
re-canonicalize the root for each entry, path, or result it produces. Each new
operation SHALL canonicalize the root again, so a root that is moved, replaced,
or made non-canonical between two operations is detected by the next one and its
sessions fail closed. A canonical root MUST NOT be carried across operations,
and a supplied root MUST still be containment-checked against every path
resolved beneath it.

#### Scenario: One listing, one root canonicalization

- **WHEN** the catalog lists a directory of many entries
- **THEN** the project root is canonicalized once for that listing
- **AND** the number of path canonicalizations stays proportional to the number
  of entries rather than to a multiple of it

#### Scenario: Root replaced between operations

- **WHEN** a project root is replaced after one operation has completed and
  another operation is then issued against the same session
- **THEN** the later operation canonicalizes the root again and fails closed
  rather than answering from the root the earlier operation resolved

#### Scenario: Containment still applies beneath a supplied root

- **WHEN** an operation resolves an entry against a root it has already
  canonicalized
- **THEN** the resolved path is still checked for containment within that root
- **AND** a path resolving outside it is rejected

## MODIFIED Requirements

### Requirement: Bounded directory catalog, search, and size traversal

The server catalog SHALL expose project-relative bounded directory pages,
filename search, non-following folder-size traversal, and create, rename, and
delete commands. Ordinary files and directories MAY reuse the contained listing
metadata the server already holds so a tree does not re-stat every child, and an
entry whose directory read already reports whether it is a symbolic link SHALL
be described from that report rather than probed again. Symlink children SHALL
still be canonicalized; escaped symlinks SHALL be reported as inaccessible
metadata and MUST NOT be traversed or mutated. Search and size traversal SHALL
enforce entry, depth, and byte caps, honour ignored-directory patterns, and
accept cancellation.

#### Scenario: Escaped symlink

- **WHEN** a directory contains a symlink resolving outside the project scope
- **THEN** it is reported as inaccessible metadata and is neither traversed nor
  mutated

#### Scenario: Cancelled search

- **WHEN** a filename search or folder-size traversal is cancelled
- **THEN** the traversal stops and returns without exceeding its entry, depth,
  or byte caps

#### Scenario: Link-ness already known from the directory read

- **WHEN** a directory read reports that an entry is not a symbolic link
- **THEN** the entry is described without an additional link probe
- **AND** the entry is still reported with its canonical kind and metadata

#### Scenario: Link-ness not reported by the directory read

- **WHEN** a directory read does not report whether an entry is a symbolic link
- **THEN** the catalog determines link-ness itself before describing the entry
