## ADDED Requirements

### Requirement: Remote Git in the service-parity phase
Git discovery, status, branches, worktrees, diffs, fetch, and reviewed Quick
Push for an SSH project SHALL execute on the target through an argv-safe
bounded SSH exec runner and a POSIX path adapter. Local Git SHALL NOT be
invoked with a remote path, commands SHALL NOT be assembled by shell
interpolation, and output, time, and concurrency SHALL be bounded. Credentials
SHALL remain target-side or in explicitly scoped SSH provider mechanisms.

#### Scenario: Git operation in an SSH project
- **WHEN** a Git operation is requested for a project bound to an SSH
  environment
- **THEN** it runs through the SSH exec runner on the target and the local Git
  binary is not invoked with the remote path

#### Scenario: Git absent on the target
- **WHEN** the target has no Git installation
- **THEN** the operation reports an explicit unavailable state rather than
  falling back to the Terminay Server machine

#### Scenario: Disconnect during a mutation
- **WHEN** the transport is lost during a Git mutation
- **THEN** the operation reports the partial mutation and revalidates revisions
  before any further work

### Requirement: Remote filesystem observation in the service-parity phase
Filesystem observation for an SSH environment SHALL be an optional provider
contract implemented by a proven remote watcher or helper, or by explicitly
configured bounded polling. Observation SHALL preserve canonical root and
symlink boundaries, coalesce bursts, recover gaps, stop work when nothing is
observed, and keep manual refresh available when observation degrades. Hidden
unbounded polling SHALL NOT occur.

#### Scenario: Two projects on one target
- **WHEN** two projects with different roots are observed on the same target
- **THEN** neither project receives the other's events

#### Scenario: Target or server restart
- **WHEN** the target or the Terminay Server restarts
- **THEN** observation produces an explicit resync rather than invented
  continuity, and the affected files and projects are preserved

#### Scenario: Observation unavailable
- **WHEN** no observation implementation is available for the environment
- **THEN** the capability reports unavailable and manual refresh remains
  available

### Requirement: Remote cwd and foreground process in the service-parity phase
Canonical working directory and foreground process SHALL be reported only from
a versioned target-side observation helper whose data is bound to the exact SSH
channel and session, and only with fresh proven session identity. Matching by
path or process name SHALL NOT establish identity. Close protection and
activity hints SHALL derive from that capability and SHALL NOT treat the
Terminay Server's SSH client process as the target process.

#### Scenario: Fresh proven session
- **WHEN** the helper reports working directory and foreground process bound to
  the exact live session
- **THEN** the server publishes them as canonical

#### Scenario: Stale or forged observation
- **WHEN** an observation is stale, cannot prove its session, belongs to another
  project, or describes the local SSH client process
- **THEN** it is rejected and an explicit unavailable or stale state is retained

### Requirement: Remote agent status in the service-parity phase
Remote agent entries SHALL be produced through provider-neutral remote journal
and source callbacks using the same process-writer proof, bounded parsing,
privacy rules, and exact session identity as local agents. Raw journals,
prompts, responses, and tool data SHALL remain on the server side. Terminal
output fallback SHALL be preserved when the helper, provider, or journal is
missing, and authoritative state SHALL NOT be synthesised from working
directory or terminal titles.

#### Scenario: Codex on an SSH target
- **WHEN** a supported Codex session is discovered through the target helper
  with process-to-journal proof
- **THEN** an authoritative agent entry is bound to that exact terminal session
  and no raw journal data is exposed to clients

#### Scenario: Helper missing
- **WHEN** the target helper or the provider journal is unavailable
- **THEN** the agent surface falls back to terminal activity and does not claim
  authoritative state

### Requirement: Remote MCP bridge
Remote MCP SHALL be reached through a target helper bridge holding a short-lived
capability scoped to the exact session, project, and environment, with mutual
server authentication, replay resistance, rotation, revocation, deadlines, and
a bounded framed transport. Only the existing project-implicit MCP surface
authorized by the Terminay Server SHALL be exposed. The server-local MCP socket
and bearer token SHALL NOT be published to the network or to an unrelated
remote process.

#### Scenario: Remote MCP call
- **WHEN** a remote MCP client calls through the bridge
- **THEN** it can control only sibling terminals in the calling remote project

#### Scenario: Replayed or revoked capability
- **WHEN** a replayed, revoked, or cross-environment capability is presented
- **THEN** the bridge rejects it

#### Scenario: Reconnect, restart, or session exit
- **WHEN** the transport reconnects, the server restarts, or the session exits
- **THEN** the capability is treated as revoked and the bridge fails closed if
  identity or environment binding has changed

### Requirement: Graceful degradation of optional remote capabilities
Every optional remote capability SHALL have either a provider-owned
implementation or an explicit proven unavailable state. A missing or failed
capability SHALL NOT be satisfied by the Terminay Server machine.

#### Scenario: Optional capability missing
- **WHEN** an optional remote capability is unavailable for an environment
- **THEN** the dependent surface reports the unavailable state and no operation
  is routed to the Terminay Server host
