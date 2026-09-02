## ADDED Requirements

### Requirement: Legacy Desktop migration inventory

Migration SHALL begin with a bounded, alias-aware preflight that inventories settings, macros, safe-storage secrets, remote devices, reconnect grants, audit records, TLS paths, recordings, and connection metadata from every supported Desktop release. The preflight SHALL report store versions and presence without reading stored values. Project files and recordings SHALL be preserved in place, and a missing path SHALL be represented explicitly in the inventory rather than omitted.

#### Scenario: Preflight excludes values

- **WHEN** the migration preflight runs against a supported Desktop profile
- **THEN** it reports store versions, presence, and paths, and reads no stored value

#### Scenario: Missing path is explicit

- **WHEN** an inventoried recording or project path no longer exists
- **THEN** the inventory represents it explicitly as missing

### Requirement: Recoverable path errors and migration safety

Import into the embedded server SHALL be idempotent, SHALL write a completion marker, SHALL take a backup before mutating, and SHALL be resumable after an interrupted run. It SHALL NOT write a plaintext secret file at any point. An interrupted import SHALL either resume or roll back from that backup.

#### Scenario: Import runs twice

- **WHEN** a completed import is run again
- **THEN** the completion marker is honoured and no state is duplicated

#### Scenario: Interrupted import recovers

- **WHEN** an import is interrupted partway
- **THEN** it resumes, or rolls back from the backup taken before mutation

#### Scenario: No plaintext secrets on disk

- **WHEN** secrets are migrated
- **THEN** no plaintext secret file is written

### Requirement: Renderer-only historic layouts are unrecoverable

Historic layouts that existed only in a renderer SHALL be reported as unrecoverable during migration preflight rather than reconstructed or guessed. On first server load the workspace repository SHALL commit the new canonical empty snapshot immediately, so the canonical state is durable from the outset.

#### Scenario: Historic layout reported unrecoverable

- **WHEN** preflight encounters a renderer-only historic layout
- **THEN** it is reported as unrecoverable and is not reconstructed

#### Scenario: Canonical snapshot committed on first load

- **WHEN** the server loads a workspace for the first time after migration
- **THEN** the empty canonical snapshot is committed immediately

### Requirement: Cloned server identities require explicit resolution

Migration SHALL detect a cloned or colliding server identity and SHALL require an explicit resolution before proceeding. It SHALL NOT merge, rename, or silently choose between colliding identities.

#### Scenario: Colliding identity halts migration

- **WHEN** two candidate profiles claim the same server identity
- **THEN** migration stops and requires an explicit resolution

### Requirement: Rollback boundary and explicit backup recovery

Pre-migration Electron state SHALL be restorable on rollback only before server-only mutations commit. After that boundary, recovery SHALL be by explicit backup recovery rather than an implicit reversal, and the boundary SHALL be reported so the operator knows which recovery applies.

#### Scenario: Rollback before the boundary

- **WHEN** migration fails before any server-only mutation commits
- **THEN** the pre-migration Electron state is restored

#### Scenario: Recovery after the boundary

- **WHEN** migration fails after a server-only mutation commits
- **THEN** rollback is refused and explicit backup recovery is offered instead

### Requirement: Connected clients hold no second authority over server-owned data

A connected client SHALL read and mutate settings, macros, secrets, recordings, AI metadata, dictation, file, and Git state only through the selected server's protocol clients. A feature client that owns live state SHALL refuse a transport that cannot establish its canonical subscription rather than returning a silent no-op, and creating a shared authenticated server context SHALL require both the activity and agent-status projections. A client-supplied cursor, revision, or identity that is not canonical SHALL be rejected rather than accepted beside the server-owned authority.

#### Scenario: Query-only transport is refused

- **WHEN** a transport supports queries and commands but cannot subscribe
- **THEN** the settings, macro, activity, agent-status, and generic feature clients refuse it instead of returning a no-op unsubscribe

#### Scenario: Partial context is not retained

- **WHEN** either the activity or the agent-status projection cannot be established
- **THEN** no shared authenticated server context is retained

#### Scenario: Non-canonical cursor is rejected

- **WHEN** a workspace delta request carries an arbitrary cursor or a malformed snapshot revision
- **THEN** it is rejected before any renderer can treat it as workspace authority

#### Scenario: Mismatched attachment identity is rejected

- **WHEN** a terminal attachment authorization names a different server, project, or session than the canonical attachment identity
- **THEN** the attachment is rejected

### Requirement: Client-host native-only operations

A client host SHALL retain only native presentation and device operations: clipboard, reveal, external URL, application and menu commands, terminal presentation zoom and size, project tab drag and popout, workspace transfer, window lifecycle, native dialogs, microphone capture and permission, and settings-window launch and focus. Each SHALL be exposed as its own frozen, versioned capability with a fixed operation set, and SHALL NOT list, read, write, or mutate project or server data except by dispatching a typed server-client command. Device-local persistence SHALL be limited to connection-host presentation fields and the microphone device override.

#### Scenario: Data method fails the declaration gate

- **WHEN** a file, project, or server data method is added to a native presentation capability
- **THEN** the declaration gate fails

#### Scenario: Device-local settings stay presentational

- **WHEN** terminal behaviour, recording, remote, shell, AI, or dictation provider settings are changed on a connected Desktop client
- **THEN** they are written through the selected server's settings client and not to the device-local settings file
