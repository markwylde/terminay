## MODIFIED Requirements

### Requirement: Local-only control endpoint

The control endpoint SHALL be local to the server machine. It SHALL NOT use WebRTC, remote-device credentials, browser storage, or the hosted signalling service. It SHALL use a user-only Unix domain socket or the platform-equivalent local IPC transport and SHALL never listen on a TCP interface. A Unix domain socket SHALL be readable and writable by its owner only, and the directory that holds it SHALL be accessible to its owner only.

#### Scenario: Endpoint transport

- **WHEN** the MCP control endpoint is created
- **THEN** it uses a user-only Unix domain socket or platform-equivalent local IPC and listens on no TCP interface

#### Scenario: Remote credential presented

- **WHEN** a request attempts to reach the control endpoint using remote-device credentials or the hosted signalling service
- **THEN** it is not served

#### Scenario: Socket and directory permissions

- **WHEN** the control endpoint is listening on a Unix domain socket
- **THEN** the socket grants access to its owner only and so does the directory that holds it

## ADDED Requirements

### Requirement: Control endpoint socket placement

The control endpoint's Unix domain socket SHALL be placed inside the server's data directory whenever the socket's path there is within the platform's limit for a Unix socket path. When it is not, the socket SHALL be placed in a runtime directory outside the data directory: a directory whose name is derived from the data directory's path, inside the user's runtime directory where the platform provides one and the system temporary directory otherwise. The same data directory SHALL always resolve to the same socket path, so that a terminal launched before a restart can still reach the endpoint after it.

A runtime directory SHALL be used only when it is a directory, is not a symbolic link, is owned by the user the server runs as, and grants no access to any other user. The server SHALL create it with those properties when it does not exist. The server SHALL NOT use, repair, or replace a path that exists and fails any of those conditions.

The platform limit SHALL be measured in bytes of the encoded path, not characters.

#### Scenario: Data directory at an ordinary path

- **WHEN** the socket's path inside the data directory is within the platform limit
- **THEN** the socket is created inside the data directory and no runtime directory is created

#### Scenario: Data directory at a long path

- **WHEN** the socket's path inside the data directory exceeds the platform limit
- **THEN** the server starts, the socket is created in an owner-only runtime directory outside the data directory, and a terminal launched by that server reaches the endpoint

#### Scenario: Same data directory, same address

- **WHEN** a server whose socket is in a runtime directory is stopped and started again with the same data directory
- **THEN** the socket is at the same path as before

#### Scenario: Two data directories

- **WHEN** two servers run with different data directories whose socket paths both exceed the limit
- **THEN** each uses its own runtime directory and neither listens on the other's socket

#### Scenario: Runtime directory prepared by someone else

- **WHEN** the runtime directory's path already exists and is a symbolic link, is not a directory, is owned by another user, or grants access to another user
- **THEN** the server does not listen there and does not change that path

#### Scenario: Non-ASCII data directory

- **WHEN** the data directory's path contains multi-byte characters and its socket path is within the limit in characters but over it in bytes
- **THEN** the socket is placed in a runtime directory

### Requirement: Reporting a control endpoint that cannot be placed

When the control endpoint's socket cannot be placed, because the data directory's path is too long and no runtime directory is usable, Desktop SHALL say so in its launch recovery state in place of the general failure message. The message SHALL state that the data directory's path is too long for a local socket, SHALL give the data directory's path, the length of the socket path, and the limit, and SHALL state that a shorter data directory resolves it. When a runtime directory was refused, the message SHALL name that directory and the reason. The failure SHALL also be recorded in Desktop diagnostics. The message SHALL NOT include a capability token.

#### Scenario: No usable placement

- **WHEN** Desktop starts with a data directory whose socket path is too long and the runtime directory's path is also over the limit
- **THEN** the launch recovery state says the data directory's path is too long for a local socket, gives the path and the limit, and says to use a shorter data directory

#### Scenario: Runtime directory refused

- **WHEN** Desktop starts with a data directory whose socket path is too long and the runtime directory exists but is owned by another user
- **THEN** the launch recovery state names that directory and says it is not owned by the current user, and Desktop does not listen there

#### Scenario: Recorded for support

- **WHEN** the control endpoint cannot be placed
- **THEN** Desktop diagnostics hold a record of the failure with the paths and lengths involved and no capability token
