# ssh-project-environments Specification

## Purpose

Define how the official SSH extension lets the selected Terminay Server open a complete project on an existing POSIX SSH host — remote PTY, SFTP filesystem, host trust, and optional service parity — without installing Terminay on that host and without clients ever holding SSH credentials.

## Requirements

### Requirement: Server-owned SSH project environments

The SSH extension SHALL let the selected Terminay Server open a complete project on an existing POSIX SSH host without installing Terminay on that host. It SHALL provide a remote PTY and an SFTP-backed project filesystem through the server-owned project environment contract. Desktop and browser clients SHALL NEVER make the SSH connection or hold its credentials. SSH SHALL also be the workspace transport used by infrastructure extensions such as Puzed after they provision or select a VM.

#### Scenario: Client opens an SSH project
- **WHEN** a Desktop or browser client opens a project bound to an SSH environment
- **THEN** the selected Terminay Server makes the SSH connection and the client neither connects nor receives credentials

#### Scenario: Remote Terminay Server context
- **WHEN** the selected Terminay Server is remote from the client
- **THEN** the connection originates from that server's own network, vault, and agent context, and diagnostics identify which server made the attempt

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

### Requirement: Supported authentication modes

The SSH extension SHALL support an imported private key in the Terminay Server vault with an optional passphrase stored as a separate scoped secret, the SSH agent available to the selected Terminay Server, and a guarded password fallback stored in the vault. Keyboard-interactive authentication, SSH certificates and FIDO, ProxyJump and bastion chains, port forwarding, and agent forwarding SHALL be unavailable and SHALL require explicit later capabilities rather than shelling out to an unbounded user command.

#### Scenario: Vault key with passphrase
- **WHEN** a profile uses an imported private key with a passphrase
- **THEN** the key and the passphrase are stored as separate scoped secrets in the Terminay Server vault

#### Scenario: Unsupported authentication requested
- **WHEN** keyboard-interactive, certificate/FIDO, ProxyJump, port forwarding, or agent forwarding is required
- **THEN** the connection does not proceed and no unbounded user command is executed

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

### Requirement: Stable logical host identity across address changes

Hostname or IP changes MAY retain trust only when the provider supplies a stable logical host identity and the pinned key still matches. Puzed SHALL use a stable machine-scoped identity while its DHCP dial address may change.

#### Scenario: DHCP address changes
- **WHEN** a Puzed VM's dial address changes but its pinned key still matches its stable machine-scoped identity
- **THEN** trust is retained without a new approval

#### Scenario: Address changes without a stable identity
- **WHEN** a host or IP changes and no stable logical host identity is supplied
- **THEN** new trust is required

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

### Requirement: Safe SSH statuses and test stages

Safe statuses SHALL include `disconnected`, `connecting`, `ready`, `host-key-approval-required`, `host-key-mismatch`, `authentication-failed`, `unreachable`, `root-unavailable`, `reconnecting`, and `disabled`. Profile testing SHALL present the stages Resolving host, Connecting, Verifying identity, Authenticating, Discovering home and shell, and Ready.

#### Scenario: Testing a profile
- **WHEN** a user tests an SSH profile
- **THEN** progress is presented through the named stages ending in Ready

#### Scenario: Status reporting
- **WHEN** an SSH environment reports status
- **THEN** the value is one of the defined safe statuses

### Requirement: Reconnection policy

The pool SHALL use keepalives, bounded exponential backoff with jitter, deadlines, and manual Retry. A new terminal or read MAY wait for one bounded connection attempt. Ambiguous filesystem mutations SHALL NEVER be blindly retried.

#### Scenario: Transient failure
- **WHEN** a connection fails transiently
- **THEN** reconnection uses bounded exponential backoff with jitter and deadlines, and manual Retry remains available

#### Scenario: Ambiguous mutation
- **WHEN** a filesystem mutation completes with an unknown outcome
- **THEN** it is not automatically retried

### Requirement: Transport loss interrupts sessions exactly once

Transport loss SHALL interrupt every affected live terminal exactly once when SSH cannot prove the channel or process survived. Reconnection SHALL permit new operations but SHALL NOT manufacture a replacement shell under the old session id. Project and panel state SHALL remain recoverable. Server restart SHALL follow the same interrupted-session contract and SHALL reconnect profiles lazily.

#### Scenario: Connection drops
- **WHEN** the SSH transport is lost and survival of the channel cannot be proven
- **THEN** each affected live terminal is interrupted exactly once

#### Scenario: After reconnection
- **WHEN** the transport reconnects
- **THEN** new operations are permitted and no replacement shell is created under the old session id, while project and panel state remain recoverable

#### Scenario: Server restart
- **WHEN** the Terminay Server restarts
- **THEN** affected sessions follow the same interrupted contract and profiles reconnect lazily

### Requirement: Project root resolution

The default project root SHALL be the configured profile default when present, otherwise the remotely discovered account home. `~` expansion SHALL occur only in the provider, and the persisted root SHALL be a verified canonical absolute remote path. Users SHALL be able to change an individual project's root through the standard project editor or the working-directory shortcut; the selected server SHALL validate that cwd on the SSH host, commit the canonical remote path as the project root, and rebind Explorer and Git to it. Profile-default changes SHALL affect future projects only.

#### Scenario: New project root
- **WHEN** a project is created on an SSH profile with no default root
- **THEN** the remotely discovered account home is used and persisted as a verified canonical absolute remote path

#### Scenario: Changing a project root
- **WHEN** a user changes a project's root through the project editor or the working-directory shortcut
- **THEN** the server validates the cwd on the SSH host, commits its canonical remote path, and rebinds Explorer and Git

#### Scenario: Changing a profile default
- **WHEN** a profile's default root changes
- **THEN** existing projects keep their roots and only future projects use the new default

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

### Requirement: Efficient SFTP session use

One SSH connection SHALL reuse a single SFTP session across listing, stat, and read calls and SHALL NOT open and wait-close a channel per child entry. Directory listings SHALL reuse the cached project-root realpath instead of repeating it for every list or stat. The cached SFTP session SHALL be released before a remote PTY is opened so a one-session guest can still accept the terminal channel.

#### Scenario: Listing a large directory
- **WHEN** a directory with many entries is listed
- **THEN** one SFTP session is reused and the cached project-root realpath is not recomputed per entry

#### Scenario: Opening a terminal on a one-session guest
- **WHEN** a remote PTY is opened on a host that permits only one session
- **THEN** the cached SFTP session is released first so the terminal channel is accepted

### Requirement: Filesystem observation unavailable in SSH v1

SFTP SHALL have no portable watch. SSH v1 SHALL advertise filesystem observation as unavailable and SHALL supply manual refresh; it SHALL NEVER watch the same path string on the Terminay Server host. Protocol operations `files.watch.*` and `files.folder-size.*` SHALL classify as `filesystem-observation`, so a missing watch never opens SFTP or shares the remote file catalog's request deadline. Later bounded provider observation or polling SHALL be declared and SHALL NOT weaken the UI's no-hidden-unbounded-polling rules.

#### Scenario: Watch requested on an SSH project
- **WHEN** a client requests filesystem observation for an SSH project in v1
- **THEN** observation is reported unavailable, manual refresh is offered, and no path is watched on the Terminay Server host

#### Scenario: Observation operation classification
- **WHEN** `files.watch.*` or `files.folder-size.*` is invoked
- **THEN** it is classified as `filesystem-observation` and does not open SFTP or consume the remote file catalog's request deadline

### Requirement: Dirty file sessions across disconnect

Dirty file sessions SHALL remain bound to the exact environment, root, and revision. A disconnect SHALL preserve drafts. An outcome-unknown save SHALL refresh canonical metadata and SHALL require reconciliation rather than automatic replay.

#### Scenario: Disconnect with unsaved work
- **WHEN** the SSH transport drops while a file draft is dirty
- **THEN** the draft is preserved and stays bound to its exact environment, root, and revision

#### Scenario: Save with unknown outcome
- **WHEN** a save completes with an unknown outcome
- **THEN** canonical metadata is refreshed and reconciliation is required instead of an automatic replay

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

### Requirement: Proof-bound remote cwd observation

Remote current cwd SHALL be observed on POSIX targets by a proof-bound `/proc` walk on the same SSH connection as the PTY. The session proof SHALL be exported into the remote shell before exec, because OpenSSH drops unadvertised `SendEnv` values. Foreground-process, native PID, and journal observation MAY still be unavailable.

#### Scenario: Observing cwd
- **WHEN** the working directory of a remote session is required
- **THEN** it is proven by matching the exported session proof in `/proc` over the same SSH connection as the PTY

### Requirement: Close protection without remote observation

Close protection SHALL warn only when a non-shell foreground process is known to be running. Missing remote observation SHALL NOT inspect the local SSH client process and SHALL NOT invent a running job. Authoritative agent integration SHALL be unavailable rather than inspecting the local SSH client process.

#### Scenario: No remote foreground observation
- **WHEN** foreground-process observation is unavailable on a remote target
- **THEN** closing proceeds without a warning and the local SSH client process is not inspected

### Requirement: Launch environment filtering at the provider boundary

Server-local launch environment SHALL be filtered at the provider boundary. Provider homes, credentials, and host-only variables SHALL NEVER be copied into the remote shell. Project and session identity variables SHALL be sent only when an explicit remote consumer capability exists.

#### Scenario: Starting a remote shell
- **WHEN** the remote shell environment is composed
- **THEN** provider homes, credentials, and host-only variables are excluded, and identity variables are sent only where an explicit remote consumer capability exists

### Requirement: SSH v1 capability availability

In SSH v1, recording SHALL operate at Terminay Server's routed terminal-stream boundary and SHALL work without target-side storage; generic terminal-output activity SHALL remain available; authoritative journal and process-tree agent status SHALL be unavailable; and Git SHALL be unavailable until the extension provides an argv-safe bounded remote runner and POSIX path adapter, and SHALL NEVER invoke local Git with a remote root. Unavailable capabilities SHALL have explicit UI states and SHALL NEVER silently execute on the Terminay Server machine.

#### Scenario: Recording a remote terminal
- **WHEN** a remote SSH terminal is recorded
- **THEN** capture occurs at the server's routed terminal-stream boundary and nothing is written on the target

#### Scenario: Git before the remote runner exists
- **WHEN** Git is requested on an SSH project without a remote runner
- **THEN** Git is shown as explicitly unavailable and local Git is never invoked with a remote root

### Requirement: Remote Git in the service-parity phase

The service-parity phase SHALL supply Git through an argv-safe bounded SSH exec runner and POSIX path adapter supporting repository discovery, status, branches, worktrees, diffs, fetch, and reviewed Quick Push. Credentials SHALL remain target-side or use an explicit scoped provider mechanism, and remote paths SHALL NEVER enter local Git. Query results SHALL use the same application-protocol shapes as This server, including `projectId` and `worktreeRoot`, so a VM home that is not a repository is an empty Git state rather than a failed load. Unknown `git.*` operations on a remote project SHALL fail closed and SHALL NEVER fall back to This server Git. Existing VMs created before the provider advertised Git SHALL still route Git through the live contribution; a create-time capability snapshot SHALL NOT hide a later Git implementation.

#### Scenario: Non-repository remote root
- **WHEN** a remote project root is not a Git repository
- **THEN** an empty Git state is returned in the standard shapes, not a failed load

#### Scenario: Unknown git operation
- **WHEN** an unknown `git.*` operation is issued on a remote project
- **THEN** it fails closed and does not fall back to This server Git

#### Scenario: VM created before Git support
- **WHEN** a VM created before the provider advertised Git requests Git
- **THEN** Git routes through the live contribution rather than a stale create-time capability snapshot

### Requirement: Remote filesystem observation in the service-parity phase

The service-parity phase SHALL supply a versioned remote watcher or helper, or an explicit bounded polling mode where necessary, publishing canonical root-scoped events, gap and resync state, and lifecycle. Observation SHALL stop when unused and SHALL always retain manual refresh as a safe fallback.

#### Scenario: Watching a remote root
- **WHEN** remote observation is available and in use
- **THEN** canonical root-scoped events, gap/resync state, and lifecycle are published, and observation stops when no longer used

### Requirement: Remote cwd and foreground process in the service-parity phase

POSIX cwd SHALL be proven on the same SSH connection by matching `TERMINAY_SESSION_PROOF` in `/proc`, and the working-directory shortcut SHALL use that live cwd. Foreground-process observation SHALL still require the versioned target helper; stale or unprovable data SHALL be labelled unavailable and SHALL NOT drive close protection.

#### Scenario: Working-directory shortcut
- **WHEN** the working-directory shortcut is used on a remote session
- **THEN** it uses the cwd proven by matching `TERMINAY_SESSION_PROOF` in `/proc` on the same SSH connection

#### Scenario: Unprovable foreground data
- **WHEN** foreground-process data is stale or unprovable
- **THEN** it is labelled unavailable and does not drive close protection

### Requirement: Remote agent status in the service-parity phase

The target helper SHALL supply process-to-journal writer proof and bounded provider-journal events for the exact session. Raw journal content SHALL remain server-private. Terminal activity SHALL remain the fallback when proof or a supported driver is unavailable.

#### Scenario: Agent status with helper present
- **WHEN** the target helper proves the journal writer for the exact session
- **THEN** bounded provider-journal events drive agent status while raw journal content stays server-private

#### Scenario: Helper or driver missing
- **WHEN** writer proof or a supported driver is unavailable
- **THEN** terminal activity is used as the fallback signal

### Requirement: Remote MCP bridge

A target bridge SHALL use short-lived, mutually authenticated, replay-resistant project, environment, and session capabilities to reach the existing server-authorized MCP surface. The server-local socket and token SHALL NEVER be exposed to the network or copied into a remote environment.

#### Scenario: Remote MCP call
- **WHEN** a remote target reaches the MCP surface through the bridge
- **THEN** it presents short-lived, mutually authenticated, replay-resistant capabilities scoped to the exact project, environment, and session

#### Scenario: Server-local MCP endpoint
- **WHEN** an SSH environment is composed
- **THEN** the server-local MCP socket and token are neither exposed to the network nor copied into the remote environment

### Requirement: Graceful degradation of optional remote capabilities

Helper absence, incompatibility, crash, target restart, or bridge revocation SHALL degrade only the affected optional capability. Terminal and filesystem sessions SHALL remain represented and no feature SHALL substitute This server state.

#### Scenario: Helper crashes
- **WHEN** the remote helper is absent, incompatible, crashes, restarts, or has its bridge revoked
- **THEN** only the affected optional capability degrades, terminal and filesystem sessions remain represented, and no This server state is substituted

### Requirement: Add SSH server setup flow

**Add SSH server…** SHALL keep the Project Environments navigation and selected Terminay Server context visible while the right-hand detail pane becomes the declarative connection form, and the user SHALL be able to cancel or save back to the same environment list without opening an unrelated full-window form. The form SHALL collect a display name; hostname, port defaulting to 22, and username; SSH agent, vault private key, or password authentication; strict host verification and the separately confirmed unsafe bypass; a default project root defaulting to `~`; and Test and Save actions.

#### Scenario: Opening the form
- **WHEN** a user chooses Add SSH server…
- **THEN** the Project Environments navigation and selected server context stay visible while the detail pane becomes the connection form, and cancel or save returns to the same environment list

#### Scenario: Form fields
- **WHEN** the connection form is shown
- **THEN** it collects display name, hostname, port defaulting to 22, username, authentication mode, verification policy, and a default project root defaulting to `~`, with Test and Save

### Requirement: Setup failure handling

Failures SHALL preserve safe fields, focus an error summary, point to the relevant field, and SHALL NEVER echo credentials or key content.

#### Scenario: Test or save fails
- **WHEN** a test or save fails
- **THEN** safe fields are preserved, an error summary receives focus and points to the relevant field, and no credential or key content is echoed

### Requirement: Creating a project from a saved profile

Selecting a saved SSH profile from the project split button SHALL perform bounded connection and root validation, then SHALL atomically create and activate the project.

#### Scenario: Selecting a saved profile
- **WHEN** a user selects a saved SSH profile from the project split button
- **THEN** bounded connection and root validation runs and the project is created and activated atomically
