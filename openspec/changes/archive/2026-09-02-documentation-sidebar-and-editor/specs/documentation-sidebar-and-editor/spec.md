## ADDED Requirements

### Requirement: Document catalog query

The server SHALL own document discovery and expose it as one bounded catalog query taking a project identity, an optional known catalog revision, and bounded paging options. Its metadata SHALL report the catalog revision, scanned entry and file counts, a partial reason when limits stopped the scan, a next cursor when more records remain, and the root observation capability. Its body SHALL carry a bounded structured list of folder and document records, where a document record contains its project-relative path, its `md` or `mdx` extension, its display title, whether that title came from frontmatter or the filename, and a bounded diagnostic when title parsing failed. The client SHALL NOT discover documents by repeatedly expanding file-explorer directories.

#### Scenario: Requesting a project catalog

- **WHEN** a client requests the document catalog for a project
- **THEN** it receives the catalog revision, scanned entry and file counts, any partial reason, any next cursor, the root observation capability, and a bounded list of folder and document records

#### Scenario: Document record contents

- **WHEN** a document record is returned
- **THEN** it carries the project-relative path, the `md` or `mdx` extension, the display title, the title source, and any bounded title diagnostic

#### Scenario: Catalog limits reached

- **WHEN** traversal depth, entry count, file count, inspected bytes, result bytes, or duration reaches its bound
- **THEN** the result is marked partial with its reason and any next cursor

#### Scenario: Cross-project request

- **WHEN** a catalog query names a project the authenticated client is not authorized for
- **THEN** the request is rejected and no records are returned

### Requirement: Coalesced catalog refresh from root observation

Catalog invalidation SHALL use the existing project-root observation subscription. An ordinary watch event SHALL schedule one coalesced catalog refresh and SHALL NOT clear the last good tree while it is in flight. A watch overflow or resync SHALL discard incremental assumptions and fetch a fresh catalog. A stale in-flight catalog response SHALL be rejected rather than applied. Subscriptions and pending refresh timers SHALL be cancelled when the project, root, or server changes.

#### Scenario: Burst of watch events

- **WHEN** several watch events arrive in quick succession
- **THEN** one coalesced catalog refresh is scheduled and the last good tree stays visible until it resolves

#### Scenario: Watch overflow

- **WHEN** the watch subscription reports overflow or resync
- **THEN** incremental assumptions are discarded and a fresh catalog is fetched

#### Scenario: Stale response

- **WHEN** a catalog response arrives for a superseded request
- **THEN** it is rejected rather than applied

#### Scenario: Project or server changes

- **WHEN** the project, root, or server changes
- **THEN** the observation subscription and any pending refresh timer are cancelled

### Requirement: Documentation pane defaults and stored-state normalization

Settings SHALL carry explicit defaults for the Documentation pane's collapsed state and height. Stored settings and stored project state that do not contain the Documentation pane SHALL normalize to exactly one collapsed Documentation pane appended once to the existing order, and SHALL NOT reorder, duplicate, or remove any other pane. Documentation folder expansion SHALL persist per project through the same server-owned state ownership as other expanded sidebar entries and SHALL NOT be written into project files.

#### Scenario: Stored state without the pane

- **WHEN** stored settings or stored project state contain no Documentation pane
- **THEN** exactly one collapsed Documentation pane is appended to the existing order
- **AND** no other pane is reordered, duplicated, or removed

#### Scenario: Folder expansion persistence

- **WHEN** a user expands Documentation folders in a project
- **THEN** the expansion persists with that project through server-owned state and no project file is modified
