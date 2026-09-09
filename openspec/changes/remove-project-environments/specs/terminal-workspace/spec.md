## ADDED Requirements

### Requirement: Current-directory and foreground-process observation

Current-directory and foreground-process observation SHALL inspect the session's own PTY process on the server that owns it.

#### Scenario: Observing a session

- **WHEN** a terminal session's current directory or foreground process is observed
- **THEN** the server inspects that session's own PTY process

### Requirement: Terminal authorization identity

The server terminal boundary SHALL use immutable `{serverId, projectId, sessionId}` identity. Input SHALL be accepted only for that exact live session and SHALL be bounded by the negotiated input-byte limit; resize and termination SHALL use the same authorization boundary.

#### Scenario: Input for another session

- **WHEN** input, resize, or termination is addressed to a session other than the exact live authorized one
- **THEN** it is rejected

## MODIFIED Requirements

### Requirement: Server-owned terminal sessions

Terminay Server SHALL create and own each terminal session with a native PTY on its own host. Xterm SHALL be a client renderer that forwards input, resize, and lifecycle commands through the application protocol. Terminay Server SHALL own PTY creation, output replay, input, resize, activity, and termination. A PTY SHALL survive browser reload, transport loss, and Electron-window close while its server remains alive. Local and remote clients SHALL use the same terminal command and stream contract, differing only in transport.

#### Scenario: Client goes away

- **WHEN** a browser reloads, a transport is lost, or an Electron window is closed
- **THEN** the server-owned PTY continues running while its server remains alive

#### Scenario: Remote client

- **WHEN** a remote client operates a terminal
- **THEN** it uses the same terminal command and stream contract as a local client, differing only in the underlying transport

### Requirement: Canonical shell and working-directory resolution

New sessions SHALL resolve a server-owned shell profile and working directory through the canonical shell profiles and terminal launch policy. Startup, new-project, new-tab, split, local, and remote creation SHALL NOT maintain separate shell or cwd fallbacks. System-default resolution SHALL happen on the server that will own the PTY, and Desktop and browser clients SHALL NOT supply their host shell as a fallback.

#### Scenario: Any creation route

- **WHEN** a terminal is created from startup, a new project, a new tab, a split, or a local or remote client
- **THEN** the same profile and cwd are resolved for the same server, project, active panel, and explicit user choices

#### Scenario: System default shell

- **WHEN** the system default shell is resolved
- **THEN** resolution happens on the server that will own the PTY
- **AND** the client host's own shell is not used as a fallback

## REMOVED Requirements

### Requirement: Terminal authorization boundary

**Reason:** It authorizes a terminal command by verifying the session's stored environment against its canonical project and by refusing a client-supplied environment id, and a session has no environment.

**Migration:** None. The identity boundary is kept as "Terminal authorization identity".

### Requirement: Provider-governed process observation

**Reason:** Every terminal session runs as a native PTY on the server that owns its project, so observation is always available and no provider capability governs it.

**Migration:** None. Observation is stated in "Current-directory and foreground-process observation".
