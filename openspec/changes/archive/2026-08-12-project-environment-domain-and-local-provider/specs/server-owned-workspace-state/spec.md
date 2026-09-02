## ADDED Requirements

### Requirement: Identity-based authority for requests
Actor identity, authorization scope, project claim, and explicit permissions
SHALL be bound to the authenticated transport. A `ClientHello` SHALL NOT confer
identity, administrative rights, or scope. This SHALL hold identically in
embedded, standalone, and test compositions.

#### Scenario: Forged client identity
- **WHEN** a client asserts another client's id or an administrative claim in
  its hello
- **THEN** the server uses only the identity and scope derived from the
  authenticated transport
- **AND** the client cannot manage or mutate unrelated environment or project
  objects

#### Scenario: Embedded composition
- **WHEN** the embedded server serves a Local client
- **THEN** authority is derived from the authenticated transport exactly as in
  the standalone composition

### Requirement: Consistency scope
Every workspace mutation SHALL resolve an explicit source and destination
project scope before it is applied, including panel create, update, close, and
move, and generic project update. An object-derived command SHALL NOT bypass
the project claim. A generic project update SHALL be presentation-only; a root
change SHALL use the prepared root-change command.

#### Scenario: Incomplete project claim
- **WHEN** a panel command arrives whose derived project scope is not covered
  by the caller's project claim
- **THEN** the mutation is rejected before it is applied

#### Scenario: Root change through a generic update
- **WHEN** a client attempts to change a project root through a generic project
  update
- **THEN** the update is treated as presentation-only and the root is unchanged
