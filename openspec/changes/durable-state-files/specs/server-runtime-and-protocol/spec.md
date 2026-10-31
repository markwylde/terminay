## MODIFIED Requirements

### Requirement: Canonical state durability

Writes that define canonical state SHALL be transactional or atomically replaceable, schema-versioned, and recoverable after interruption. The storage implementation SHALL remain behind a repository boundary supporting atomic multi-object commits, revision lookup, bounded concurrent access, integrity checks, and recoverable backups.

Every file Terminay writes to hold its own state SHALL be replaced durably: the new content SHALL reach stable storage before it replaces the previous file, and the replacement SHALL itself be made durable where the platform allows. A save SHALL NOT be reported as committed before its content is durable. No state file SHALL be rewritten in place. This SHALL hold for canonical state, settings, secret and credential stores, and rebuildable records alike, on Windows, macOS, and Linux.

#### Scenario: Interrupted write

- **WHEN** a canonical state write is interrupted
- **THEN** the state is recoverable and no partially applied write is presented as committed

#### Scenario: Multi-object mutation

- **WHEN** a mutation spans multiple canonical objects
- **THEN** it commits atomically

#### Scenario: Power lost after a save

- **WHEN** the machine loses power or the operating system stops at any moment after a state save has been reported as committed
- **THEN** that file holds either the committed content or, if the loss came first, the content before the save, and never zero bytes or a mix of the two

### Requirement: Corrupt state preservation

Corrupt canonical state SHALL be preserved for diagnosis and recovered from the last valid committed state where possible, and SHALL never be silently replaced with defaults.

A state file that is unreadable, unparseable, or fails validation SHALL be moved aside under a name that marks it corrupt and SHALL NOT be deleted. What happens next SHALL depend on the kind of state:

- Canonical state and settings SHALL keep the previous committed copy beside the current one. When the current file is corrupt and that copy is valid, the server SHALL load the copy and tell the user, once, that it restored an earlier save. When no valid copy exists, the server SHALL NOT start that state empty on its own. The user SHALL choose between starting it fresh and leaving it untouched.
- A secret, credential, pairing, or revocation store SHALL NOT be restored from an older copy. When it is corrupt, it SHALL be moved aside and the store SHALL fail closed, holding no secret and admitting no device until the user sets it up again, and the user SHALL be told.
- Rebuildable state, such as session-holder records, the copied holder runtime, and derived caches, SHALL be moved aside and rebuilt without asking. A corrupt record SHALL NOT stop startup.

#### Scenario: Corrupt canonical state on load

- **WHEN** canonical state is found corrupt
- **THEN** it is preserved for diagnosis and recovery uses the last valid committed state rather than silently reverting to defaults

#### Scenario: Workspace restored from the previous save

- **WHEN** the workspace file is zero-filled at startup and its previous committed copy is valid
- **THEN** the zero-filled file is kept aside, the previous copy is loaded, and the user is told that an earlier save was restored

#### Scenario: No good copy

- **WHEN** a settings file and its previous copy are both unreadable at startup
- **THEN** both are kept aside, and the settings are neither reset nor loaded until the user chooses to start them fresh

#### Scenario: Corrupt device credential store

- **WHEN** the remote device credential store is unreadable
- **THEN** it is kept aside, no device is admitted, no older copy is loaded, and the user is told to pair again

#### Scenario: Corrupt session-holder record

- **WHEN** a session-holder record is zero-filled at startup
- **THEN** it is kept aside, its holder is treated as gone, and startup continues

## ADDED Requirements

### Requirement: Verified holder runtime copy

On Windows, the copy of the runtime a session holder runs from SHALL record the size and content digest of each of its files when it is made, and SHALL be flushed to stable storage before it is marked complete. Before a holder is started from a copy, the copy SHALL be checked against that record. A copy that is missing its record, or has any file that does not match, SHALL be moved aside and made again from the installation. A holder SHALL never be started from a copy that failed the check.

#### Scenario: Zero-filled runtime after power loss

- **WHEN** the copied holder runtime's native terminal module is zero-filled after a power loss
- **THEN** the next launch moves that copy aside, copies the runtime again from the installation, and starts terminals from the new copy

#### Scenario: Intact copy reused

- **WHEN** every file of the copied runtime matches its record
- **THEN** the copy is used as it is, and nothing is copied again
