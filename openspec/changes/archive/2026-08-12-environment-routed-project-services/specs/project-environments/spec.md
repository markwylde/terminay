## ADDED Requirements

### Requirement: Runtime routing pipeline
Every privileged project service — terminal runtime, launch resolution, filesystem, Git,
path and CLI services, process and journal observation, and macro file fields — SHALL be
resolved through the canonical project environment for the exact project it acts on. No such
service SHALL be composed against a global server-host adapter.

#### Scenario: Sentinel work stays in its environment
- **WHEN** two projects bound to different environments each run a sentinel command and read
  a sentinel path
- **THEN** each operation executes only on its own environment and neither crosses into the
  other adapter

#### Scenario: Client cannot select the machine
- **WHEN** a request carries an environment id, hostname, IP, URL, or path that differs from
  the project's canonical binding
- **THEN** the server routes by the canonical binding and ignores the supplied value

### Requirement: Unavailable capabilities never fall back to the server host
When a project's environment does not declare a capability, or its provider is missing or
failing, the affected surface SHALL report a typed unavailable state. The operation SHALL
NOT be executed on the Terminay Server host instead.

#### Scenario: Undeclared Git support
- **WHEN** a project's environment does not declare Git support
- **THEN** Git surfaces report unavailable and no Git command runs on the server host

#### Scenario: Provider missing
- **WHEN** a project's environment provider is unavailable
- **THEN** the project and its panels remain represented with typed unavailable state rather
  than silently operating against This server

### Requirement: Capability-gated observation
Working-directory observation, foreground process observation, agent journal observation,
and terminal close protection SHALL be gated by the environment's declared capabilities.
Recording and terminal-output activity SHALL remain universal because they observe the
server-owned stream rather than the project machine.

#### Scenario: Observation without host capability
- **WHEN** an environment declares no process observation capability
- **THEN** cwd and foreground observation and agent journal discovery are not attempted for
  its terminals, while recording and output activity still work

### Requirement: Server-local values do not cross a remote boundary
Launch environments for non-local environments SHALL exclude server-local MCP socket paths,
server control variables, and provider-local paths.

#### Scenario: Remote shell environment
- **WHEN** a terminal is launched on a remote environment
- **THEN** its environment contains no server-local MCP socket path, control variable, or
  provider-local path

### Requirement: Transport loss and ambiguous writes
Provider errors SHALL be normalized into typed failures. A provider transport loss SHALL
scope interruption, draft retention, and status to the affected environment, dirty drafts
SHALL be preserved, and a write whose outcome is unknown SHALL be represented as ambiguous
rather than retried automatically. Root and context changes SHALL commit transactionally.

#### Scenario: Disconnect preserves drafts
- **WHEN** a provider transport is lost while a file has unsaved changes
- **THEN** the dirty draft is preserved and only the affected environment's projects report
  interruption

#### Scenario: Ambiguous write is not retried
- **WHEN** a write's completion cannot be confirmed after a transport failure
- **THEN** it is reported as ambiguous and is not retried blindly
