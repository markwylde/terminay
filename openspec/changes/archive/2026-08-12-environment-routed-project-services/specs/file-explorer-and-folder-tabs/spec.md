## ADDED Requirements

### Requirement: Environment-routed filesystem ownership
Root preparation and browsing, canonical path resolution, directory catalog, file content
and editing sessions, folder task aggregation, uploads, and watch observation SHALL execute
on the filesystem of the project's canonical environment.

#### Scenario: Explorer reads the project's environment
- **WHEN** the Explorer lists or reads entries for a project bound to a non-local environment
- **THEN** the operations execute on that environment's filesystem and never on the server
  host filesystem

#### Scenario: Bounded typed failure
- **WHEN** the environment filesystem rejects or cannot complete an Explorer operation
- **THEN** the Explorer reports a bounded typed failure rather than falling back to another
  filesystem
