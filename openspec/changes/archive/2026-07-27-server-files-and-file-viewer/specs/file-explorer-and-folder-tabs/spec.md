## ADDED Requirements

### Requirement: Server-side path scoping for filesystem operations
Every filesystem operation SHALL be dispatched as a server command that
re-resolves the supplied path against the canonical project root and rejects
any path that escapes it, including traversal segments, symlink escapes, and
case aliases. A client-supplied path SHALL NOT confer authority.

#### Scenario: Path outside the project root
- **WHEN** a client requests a listing, read, or mutation for a path that
  resolves outside the canonical project root
- **THEN** the server rejects the operation with a bounded typed error and
  performs no filesystem work

#### Scenario: Symlink escape
- **WHEN** a requested path resolves through a symlink to a location outside
  the canonical root
- **THEN** the server rejects the operation

### Requirement: Bounded directory catalog, search, and size traversal
The server SHALL expose listing, search, and directory-size traversal as
bounded commands with limits on recursion depth, entry count, and concurrent
work, and SHALL return a truncation indication rather than an unbounded result.

#### Scenario: Large directory tree
- **WHEN** a listing or size traversal exceeds its configured bounds
- **THEN** the server returns the bounded partial result together with its
  truncation state

### Requirement: Bounded recursive Markdown task aggregation
Recursive Markdown task aggregation SHALL run on the server through the
`files.tasks` query, apply deterministic directory ordering before recursion,
and bound recursion depth, file count, content bytes, and concurrent work.

#### Scenario: Folder Tasks view opened
- **WHEN** a folder panel requests aggregated Markdown tasks for a project
  subtree
- **THEN** the server returns the parsed completed and remaining tasks with
  canonical totals, without the client performing directory recursion or
  per-file reads

#### Scenario: Aggregation reaches its bound
- **WHEN** the aggregation reaches its file, byte, or depth bound
- **THEN** the returned partial result is determined by the deterministic
  directory ordering and not by host directory enumeration order

### Requirement: Server-owned watch delivery
Filesystem watches SHALL be keyed by server, project, resource, and client
subscription identity. A watch SHALL NOT be keyed by a renderer or window
identifier, and watch events SHALL NOT be delivered to a client that is not
subscribed to that exact resource.

#### Scenario: Renderer reload
- **WHEN** a client renderer reloads and resubscribes with its client
  subscription identity
- **THEN** watch delivery resumes for the same server, project, and resource

#### Scenario: Stale watch cursor
- **WHEN** a client resumes a watch with a cursor the server can no longer
  serve
- **THEN** the server signals a bounded restart from offset zero rather than
  emitting invented continuity
