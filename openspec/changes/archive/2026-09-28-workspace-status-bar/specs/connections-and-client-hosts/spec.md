## MODIFIED Requirements

### Requirement: Header server control presentation

The header SHALL display a connections control naming the active tab's server label rather than the transport, followed by a chevron that opens the connection menu. The control SHALL NOT carry an exposure icon or a connection-count pill; exposure state and active connections are shown by the workspace status bar and started or stopped from the connection menu. The control's accessible name SHALL still state whether that server is exposed and how many remote connections are active. The header SHALL report that server's profile label and status, including Local failure or offline state, and SHALL never show a transport name or the opaque session-id hostname. Browser sessions SHALL use the saved connection title, falling back to the pairing `hostName`.

#### Scenario: Exposure icon reflects state

- **WHEN** the active tab's server is exposed
- **THEN** the header control shows the server label and chevron with no exposure icon, and the workspace status bar dot reflects the exposure state

#### Scenario: Connection pill hidden at zero

- **WHEN** the active tab's server has any number of active remote connections, including zero
- **THEN** the header control shows no count pill, and the workspace status bar carries the connection count

#### Scenario: Accessible name carries the state

- **WHEN** the active tab's server is not exposed
- **THEN** the header control's accessible name states that it is offline

#### Scenario: Label never shows the session hostname

- **WHEN** a browser session is connected to a remote server
- **THEN** the header shows the saved connection title, or the pairing `hostName`, and never the opaque session-id hostname
