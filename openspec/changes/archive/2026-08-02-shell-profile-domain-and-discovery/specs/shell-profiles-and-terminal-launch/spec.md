## ADDED Requirements

### Requirement: Profile identity and fields
A shell profile SHALL be a bounded server-owned record with a stable id, a display name,
presentation metadata, a source (system default, discovered, or custom), an order, an
availability state, a structured launch target, a startup mode, an argument array, and an
optional environment overlay. Renaming or reordering a profile SHALL preserve its identity.

#### Scenario: Rename preserves identity
- **WHEN** a custom profile is renamed or moved in the order
- **THEN** its id is unchanged and every reference to it remains valid

#### Scenario: Argument boundaries preserved
- **WHEN** a profile stores arguments
- **THEN** they are stored as an array with boundaries preserved, and a single shell-parsed command string is rejected

### Requirement: This server launch targets
A launch target SHALL be structured. A native target names an executable path; a WSL target
names an installed distribution. A malformed or unsupported target shape SHALL be rejected.

#### Scenario: Malformed target
- **WHEN** a profile is saved with an unsupported or malformed target shape
- **THEN** the mutation is rejected and the stored catalogue is unchanged

### Requirement: Environment overlay semantics and protected variables
An environment overlay SHALL set or, with a `null` value, remove a variable. Protected
environment names and secret-like fields SHALL be rejected. Profiles SHALL NOT contain secrets
or executable script.

#### Scenario: Null removal
- **WHEN** an overlay entry has a `null` value
- **THEN** that variable is removed for the launched shell rather than set to an empty value

#### Scenario: Protected name rejected
- **WHEN** an overlay names a protected variable or a secret-like field
- **THEN** the mutation is rejected

### Requirement: Profile bounds
An encoded profile SHALL NOT exceed 16 KiB and the encoded catalogue SHALL NOT exceed 32 KiB in
aggregate. Duplicate ids, duplicate names, invalid references, and over-limit collections SHALL
be rejected.

#### Scenario: Over-limit profile
- **WHEN** a profile would exceed its per-profile or aggregate encoded budget
- **THEN** the mutation is rejected with a bounds result

### Requirement: Environment-routed shell discovery
The server SHALL own shell discovery and validation. Discovered candidates SHALL be kept
separate from durable settings, and discovered host paths SHALL be canonicalized and
deduplicated. Discovery SHALL change availability without deleting a custom profile or changing
a selected default.

#### Scenario: Availability change only
- **WHEN** discovery no longer finds the executable behind a custom profile
- **THEN** the profile is marked unavailable, is not deleted, and the selected default is unchanged

### Requirement: POSIX discovery and fallback order
On macOS and Linux the server SHALL resolve System default from the account shell and SHALL
return deduplicated executable candidates from `/etc/shells`. A missing or invalid inherited
`SHELL` value SHALL NOT override the account shell.

#### Scenario: Clean POSIX server
- **WHEN** a clean macOS or Linux server reports its catalogue
- **THEN** System default resolves from the account shell and `/etc/shells` candidates are deduplicated and executable

#### Scenario: Invalid inherited SHELL
- **WHEN** the inherited `SHELL` value is missing or invalid
- **THEN** the account shell is used instead

### Requirement: Windows discovery and system default order
On Windows the server SHALL discover PowerShell 7, Windows PowerShell, Command Prompt, Git Bash,
and installed WSL distributions as structured targets, and SHALL report each only when available.

#### Scenario: Only available candidates
- **WHEN** a Windows fixture lacks Git Bash or a WSL distribution
- **THEN** that candidate is absent from the catalogue rather than reported as available

### Requirement: Discovered profile metadata, copying, and availability
A discovered profile MAY be used for a one-off launch from the current catalogue. Copying a
discovered profile SHALL create a durable custom profile explicitly.

#### Scenario: One-off launch
- **WHEN** a discovered profile is selected for a single terminal launch
- **THEN** the launch is permitted without creating a durable profile

### Requirement: Durable defaults reference durable profiles
A server default or a project default SHALL reference only System default or a durable custom
profile. A discovered profile SHALL NOT become a durable default until it has been copied into a
validated custom profile.

#### Scenario: Discovered profile as default
- **WHEN** a discovered profile is set as a server or project default
- **THEN** the mutation is rejected until the profile has been copied into a durable custom profile

### Requirement: Catalogue responses redact environment values
Catalogue and settings summaries SHALL redact environment values. One bounded profile detail
SHALL be returned only to a write-authorized client. Audit and diagnostic records for discovery,
validation, migration, and mutation SHALL be metadata-only and SHALL NOT record environment
values.

#### Scenario: Read-authorized catalogue
- **WHEN** a read-authorized client requests the catalogue
- **THEN** environment values are redacted

#### Scenario: Metadata-only audit
- **WHEN** a discovery, validation, migration, or mutation outcome is recorded
- **THEN** the record is bounded metadata and contains no environment value

### Requirement: Referenced profile deletion and unavailable selections
Deleting a profile that is referenced by a server or project default SHALL fail and SHALL report
every blocking reference. After those references are independently reassigned through their own
revisioned authorities, deletion SHALL recheck and succeed without leaving a dangling reference.

#### Scenario: Blocked deletion
- **WHEN** deletion is requested for a referenced profile
- **THEN** the request fails and names every blocking server and project reference

#### Scenario: Deletion after reassignment
- **WHEN** every blocking reference has been reassigned through its own revisioned authority
- **THEN** deletion rechecks and succeeds with no dangling reference

### Requirement: Privileged profile configuration authority
Profile catalogue and discovery reads SHALL require read authorization. Custom-profile and
default mutations SHALL require write authorization and SHALL carry revisions, command-id
idempotency, conflict results, a shared mutation lock, and referential-integrity checks. A
client SHALL NOT persist a profile or a project default outside its connected server, and SHALL
NOT supply an executable or environment through a project-default command.

#### Scenario: Independent server catalogues
- **WHEN** two servers with different installed shells are queried
- **THEN** each returns its own catalogue and a client cannot write one server's profile to the other

#### Scenario: Concurrent conflicting mutation
- **WHEN** two mutations target the same revision
- **THEN** the shared mutation lock serializes them and the losing request receives a conflict result

#### Scenario: Idempotent retry
- **WHEN** the same command id is submitted twice
- **THEN** the mutation is applied once

### Requirement: Ownership of profile and launch persistence
The profile subtree SHALL be reserved from generic settings mutation, and profile-default
project commands SHALL be reserved from generic workspace mutation, so dedicated validation and
referential checks cannot be bypassed.

#### Scenario: Generic settings write refused
- **WHEN** a generic settings mutation targets the profile subtree
- **THEN** it is refused

#### Scenario: Generic workspace write refused
- **WHEN** a generic workspace mutation targets a project's default profile reference
- **THEN** it is refused

### Requirement: Legacy shell settings migration
Migration from `shell.program`, `shell.startupMode`, and `shell.extraArgs` SHALL be idempotent.
It SHALL use deterministic migrated ids, parse legacy arguments exactly once, back up the
repository before writing, and be safe to retry after interruption. A legacy value that cannot be
migrated safely SHALL produce an unavailable state requiring review rather than being discarded
or guessed.

#### Scenario: Retry after interruption
- **WHEN** migration is interrupted and rerun
- **THEN** it completes with the same deterministic ids and no duplicated profiles

#### Scenario: Invalid legacy value
- **WHEN** a legacy value cannot be migrated safely
- **THEN** the resulting profile is marked unavailable for review rather than silently dropped

#### Scenario: Quoted legacy arguments
- **WHEN** the legacy argument string contains quoted or escaped arguments
- **THEN** it is parsed once into an argument array preserving the intended boundaries
