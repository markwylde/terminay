## MODIFIED Requirements

### Requirement: Extension packaging and ownership

`terminay-plugin-ssh` SHALL be an independently publishable npm package under `extensions/ssh`, a built-in extension, and an official catalogue entry, using only the public server extension platform. The selected Terminay Server SHALL own its installation, profiles, trusted host keys, vault references, connection pool, runtime status, and audit records.

#### Scenario: Extension uses only public platform APIs
- **WHEN** the SSH extension is installed on a server
- **THEN** it operates through the public extension platform and the server owns its profiles, trust records, vault references, pool, status, and audit

### Requirement: SSH profile contents and revisions

An SSH profile SHALL contain bounded non-secret configuration: a stable id and immutable configuration revision; display name, hostname, port, and username; authentication mode and namespaced secret references; strict or explicitly unsafe host-verification policy and trust-record metadata; an optional default project root; connect, handshake, and keepalive timeouts; and safe status and last-success metadata. Changing host or port SHALL require new trust. Editing a profile SHALL create a new revision, and active projects SHALL stay pinned to their revision until an explicit validated update. Removal SHALL be blocked while the profile is referenced.

#### Scenario: Editing a profile
- **WHEN** a user edits an SSH profile
- **THEN** a new configuration revision is created and active projects remain pinned to their existing revision until explicitly updated after validation

#### Scenario: Changing host or port
- **WHEN** a profile's hostname or port changes
- **THEN** new host-key trust is required

#### Scenario: Removing a referenced profile
- **WHEN** a user attempts to remove a profile that projects still reference
- **THEN** removal is blocked

### Requirement: Strict host verification by default

Host verification SHALL be strict by default. First contact SHALL pause with `host-key-approval-required` and present a server-observed host, port, key algorithm, and SHA-256 fingerprint. **Trust and continue** SHALL be a revisioned, one-use command bound to the exact connection challenge, and SHALL store the exact public host key rather than merely its display fingerprint.

#### Scenario: First contact
- **WHEN** a server connects to an unknown SSH host
- **THEN** the connection pauses with `host-key-approval-required` showing the observed host, port, key algorithm, and SHA-256 fingerprint

#### Scenario: Approving trust
- **WHEN** a user issues Trust and continue for that exact challenge
- **THEN** the exact public host key is stored and the one-use revisioned command cannot be replayed

### Requirement: Host key mismatch fails closed

A later different host key SHALL fail closed as `host-key-mismatch`, SHALL show the expected and actual fingerprints, and SHALL require a separate deliberate **Replace trusted key…** action. A stale or replayed approval SHALL NOT change trust.

#### Scenario: Key changed
- **WHEN** a host presents a different key from the pinned one
- **THEN** the connection fails closed as `host-key-mismatch` showing expected and actual fingerprints

#### Scenario: Replacing trust
- **WHEN** a user performs Replace trusted key…
- **THEN** trust is replaced only through that separate deliberate action, and a stale or replayed approval cannot change trust

### Requirement: Per-profile unsafe verification bypass

The per-profile checkbox **Disable host key verification (unsafe)** SHALL be off by default, SHALL require explicit permission and confirmation, SHALL stay visibly warned, and SHALL be audited. There SHALL be no global bypass and it SHALL NEVER be silently inherited. Turning it off SHALL return to strict verification.

#### Scenario: Enabling the bypass
- **WHEN** a user enables Disable host key verification (unsafe) on a profile
- **THEN** explicit permission and confirmation are required, the state remains visibly warned, and the action is audited

#### Scenario: No inheritance
- **WHEN** a new profile or environment is created
- **THEN** it uses strict verification and does not inherit any bypass

### Requirement: Structured connection without shell interpolation

Terminay Server SHALL open SSH directly using structured host, port, username, and auth inputs and SHALL NOT construct an interpolated shell command. A pool MAY share one transport per exact profile revision while preserving project, root, session, and channel identities and bounded channel counts.

#### Scenario: Opening a connection
- **WHEN** the server connects to an SSH host
- **THEN** it passes structured host, port, username, and auth inputs and does not build an interpolated shell command

#### Scenario: Pooled transport
- **WHEN** several projects share one exact profile revision
- **THEN** a shared transport may be used while project, root, session, and channel identities and bounded channel counts are preserved

### Requirement: Remote PTY on POSIX targets

SSH v1 SHALL support POSIX targets. It SHALL request a remote PTY and adapt its channel to Terminay's server-owned terminal service for bytes, resize, exit, kill, backpressure, attachment, presentation recovery, activity, recording, and client-disconnect behaviour.

#### Scenario: Opening a remote terminal
- **WHEN** a terminal is created on an SSH project
- **THEN** a remote PTY is requested and behaves through the server-owned terminal service for input, resize, exit, kill, backpressure, attachment, recovery, activity, and recording

### Requirement: Trusted remote shell launch

The initial catalogue SHALL provide **Remote system default**. Terminay SHALL validate and launch a trusted provider-generated shell at the canonical project root; it SHALL NOT apply local server shell profiles and SHALL NOT accept a renderer-generated command string.

#### Scenario: Launching the remote shell
- **WHEN** a remote terminal starts
- **THEN** a trusted provider-generated shell launches at the canonical project root, ignoring local server shell profiles and any renderer-supplied command string

### Requirement: SFTP filesystem adapter

The provider SHALL expose a bounded pre-project remote directory browser and an SFTP filesystem adapter for canonical realpath, stat, lstat, list, ranged read, write, create, rename, and remove. SFTP errors SHALL normalize into Terminay's host-neutral missing, not-directory, permission, and conflict vocabulary before path resolution. Raw numeric SFTP statuses SHALL NEVER bypass canonicalization.

#### Scenario: SFTP error normalisation
- **WHEN** SFTP returns a numeric status
- **THEN** it is normalized to the host-neutral vocabulary before path resolution rather than surfacing raw

### Requirement: Remote filesystem safety rules

Project containment, symlink, size, depth, count, byte, cancellation, conflict, and destructive-confirmation rules SHALL apply against the remote filesystem. Writes SHALL use a random sibling temporary file plus rename when the server supports it, with bounded cleanup. Unsupported atomic rename, cross-device replacement, partial upload, disk full, and disconnect SHALL return explicit outcomes.

#### Scenario: Atomic write
- **WHEN** a file is written over SFTP on a host supporting rename
- **THEN** the write uses a random sibling temporary file plus rename, with bounded cleanup

#### Scenario: Write cannot complete
- **WHEN** atomic rename is unsupported, replacement is cross-device, an upload is partial, the disk is full, or the connection drops
- **THEN** an explicit outcome is returned rather than a silent failure

#### Scenario: Escaping the project root
- **WHEN** a remote path or symlink would escape the canonical project root
- **THEN** the operation is rejected by the containment rules

### Requirement: Credential context is the server's

The UI SHALL explain that a remote Terminay Server uses its own vault and `SSH_AUTH_SOCK`, never a keychain, file, or SSH agent on the Desktop or browser device. A client-local file picker SHALL NOT silently configure a remote server.

#### Scenario: Configuring a remote server's key
- **WHEN** a user configures key authentication for a remote Terminay Server
- **THEN** the UI states that the remote server's own vault and agent are used, and a client-local file picker cannot silently configure that server

### Requirement: Secret values never leave the vault boundary

Secret values SHALL NEVER appear in profiles, workspace snapshots, renderer state, URLs, commands, argv, logs, audit, diagnostics, or error text. The SSH extension SHALL receive only the exact profile and purpose secret needed for a connection attempt.

#### Scenario: Connection attempt
- **WHEN** the extension makes a connection attempt
- **THEN** it receives only the exact profile/purpose secret required, and no secret value appears in any snapshot, log, audit record, diagnostic, or error text
