## ADDED Requirements

### Requirement: Data-root-scoped server authority identity

Every implicit embedded or standalone server SHALL derive a durable identity scoped to its own data root, so two `terminay-server` processes with separate data roots and endpoints never default to one shared identity. That resolved identity SHALL thread the server's terminal, workspace, environment, recording, local UI, profile, cache, and exposure composition, and SHALL remain stable across restarts. An explicit `--server-id` SHALL remain an intentional operator choice and SHALL be rejected when its endpoint or data-root ownership is inconsistent. A legacy fixed local identity record SHALL migrate atomically to the data-root-scoped identity, and an identity record belonging to another data root SHALL fail closed rather than being adopted.

#### Scenario: Two implicit servers

- **WHEN** two servers start with separate data roots and endpoints and no explicit identity
- **THEN** each receives a distinct durable identity, profile, partition, and store

#### Scenario: Restart

- **WHEN** a server restarts against the same data root
- **THEN** it resolves the same durable identity

#### Scenario: Inconsistent explicit identity

- **WHEN** an explicit `--server-id` is inconsistent with the endpoint or data-root ownership
- **THEN** startup is rejected

#### Scenario: Foreign identity record

- **WHEN** an identity record belonging to another data root is found
- **THEN** it fails closed and is not adopted
