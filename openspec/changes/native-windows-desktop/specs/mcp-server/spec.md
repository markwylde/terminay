## MODIFIED Requirements

### Requirement: Local-only control endpoint

The control endpoint SHALL be local to the server machine. It SHALL NOT use WebRTC, remote-device credentials, browser storage, or the hosted signalling service. It SHALL use a user-only Unix domain socket or, on Windows, a named pipe, and SHALL never listen on a TCP interface. A Unix domain socket SHALL be readable and writable by its owner only, and the directory that holds it SHALL be accessible to its owner only. A named pipe SHALL have a name derived from the current user's security identifier and the data directory's absolute path, SHALL be created as the first instance of that name under a security descriptor that grants write access only to the current user, the operating system, and administrators. A client of the pipe, whether on this machine or reaching it over the network as one of those principals, SHALL be served nothing that a capability token does not authorise. A server that finds the name already taken SHALL NOT listen on it and SHALL report the endpoint as unplaceable.

#### Scenario: Endpoint transport

- **WHEN** the MCP control endpoint is created
- **THEN** it uses a user-only Unix domain socket or, on Windows, a user-only named pipe, and listens on no TCP interface

#### Scenario: Remote credential presented

- **WHEN** a request attempts to reach the control endpoint using remote-device credentials or the hosted signalling service
- **THEN** it is not served

#### Scenario: Socket and directory permissions

- **WHEN** the control endpoint is listening on a Unix domain socket
- **THEN** the socket grants access to its owner only and so does the directory that holds it

#### Scenario: Two Windows users

- **WHEN** two Windows users on one machine each run Terminay with MCP enabled
- **THEN** each server listens on its own pipe, and neither user's terminal can reach the other's endpoint

#### Scenario: Pipe reached without a token

- **WHEN** a client opens the Windows control pipe, locally or over the network, and presents no valid capability token
- **THEN** no operation is served to it

#### Scenario: Pipe name taken

- **WHEN** a pipe with the endpoint's name already exists when the server starts on Windows
- **THEN** the server does not listen on it, and Desktop reports that the control endpoint could not be placed
