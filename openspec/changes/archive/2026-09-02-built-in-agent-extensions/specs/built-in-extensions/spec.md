## ADDED Requirements

### Requirement: Packaged runtime activation of built-in agent extensions

A packaged Electron application and a packaged standalone Terminay Server SHALL activate every staged built-in extension from their own packaged resource root rather than from a development staging directory or repository source. A packaged runtime SHALL admit an agent terminal and reduce that provider's canonical lifecycle through the packaged extension host. The packaged lifecycle matrix SHALL cover offline first run, restart, persisted disablement, a compatible npm override, rollback and removal to the bundled floor, and corrupted-artifact failure isolation. Packaging SHALL regenerate stale staged artifacts rather than accepting a stale staging directory.

#### Scenario: Packaged resource root activation

- **WHEN** a packaged Electron or standalone server starts
- **THEN** every built-in extension activates from that distribution's packaged resource root

#### Scenario: Agent admission in a packaged runtime

- **WHEN** an agent CLI runs in a terminal of a packaged runtime
- **THEN** the packaged extension host admits it and its canonical provider lifecycle is reduced in the agent store

#### Scenario: Stale staged artifacts

- **WHEN** packaging finds staged built-in artifacts that no longer match their sources
- **THEN** the artifacts are regenerated before the package is produced

#### Scenario: Packaged lifecycle matrix

- **WHEN** the packaged lifecycle matrix runs
- **THEN** offline first run, restart, persisted disablement, compatible override, rollback to the bundled floor, and corrupted-artifact isolation all behave as specified

### Requirement: Supported-architecture release verification

Built-in extension artifacts SHALL be verified on the declared supported distribution matrix: Terminay Desktop on macOS arm64 and GNU/Linux x64, and standalone Terminay Server on GNU/Linux x64 and arm64. Verification SHALL run from a clean dependency install, SHALL assert the runtime and machine architecture it claims to prove, and SHALL NOT accept an emulated build as evidence for an architecture it did not natively execute. The Electron resource inventory and the standalone payload inventory SHALL be byte-identical.

#### Scenario: Architecture assertion

- **WHEN** a packaged built-in lifecycle job runs on a release runner
- **THEN** it asserts the runtime and machine architecture before running the offline lifecycle check

#### Scenario: Emulated build

- **WHEN** an architecture is exercised only through emulation
- **THEN** the run is not accepted as evidence for that architecture

#### Scenario: Inventory parity

- **WHEN** the Electron and standalone inventories for one release are compared
- **THEN** they are byte-identical and rehash to the same built-in packages

### Requirement: Development staging and admission of built-in extensions

The development launch path SHALL stage the packed built-in artifacts before Electron starts, SHALL use the selected development resource root rather than an installed-app resource root for staging and discovery, and SHALL recover when the development artifact directory is absent. A development run SHALL be able to admit a real agent CLI in the selected project's terminal, publish its canonical root, later children, and live title changes, and render them in the Agents sidebar. Stale installed or failed extension records SHALL be migrated so they cannot mask a newly materialized bundled floor. Ordinary startup failures SHALL remain visible as startup failures and SHALL NOT be classified as canonical persisted-workspace recovery.

#### Scenario: Development pre-stage

- **WHEN** the development command launches Electron
- **THEN** the packed built-ins are staged from the development resource root beforehand, and an absent artifact directory is recovered rather than fatal

#### Scenario: Development agent admission

- **WHEN** a supported agent CLI runs in a development run's selected terminal
- **THEN** its canonical root, later child sessions, and live title changes appear in the Agents sidebar

#### Scenario: Legacy failed record

- **WHEN** a stale installed or failed extension record exists for a built-in id
- **THEN** it is migrated and does not mask the newly materialized bundled floor

#### Scenario: Startup failure classification

- **WHEN** an ordinary startup failure occurs
- **THEN** it is reported as a startup failure rather than as persisted-workspace recovery
