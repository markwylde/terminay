## MODIFIED Requirements

### Requirement: Standalone server operation

The standalone foreground command SHALL report readiness and a clear data and log location. The pairing command SHALL ask the running server, through the owner-only socket inside its data root, for its live pairing handoff and SHALL print a short-lived secure pairing URL for each active exposure mode; every device that opens one MUST be approved on the host with the match code, announced as a metadata-only log line and decided through the owner-only approval socket in the data root. The pairing command SHALL fail with a clear message when no server owns the data root. The runtime SHALL handle `SIGINT` and `SIGTERM` with bounded graceful shutdown that finalizes recordings, closes clients, and terminates or preserves child processes according to the session-lifetime policy. Unsupported native dependencies SHALL fail during startup with actionable platform and architecture guidance.

#### Scenario: Foreground start

- **WHEN** the standalone server starts in the foreground
- **THEN** it emits a bounded readiness record naming the data and log locations

#### Scenario: Pairing command

- **WHEN** the operator runs the pairing command against a data root a live server owns
- **THEN** the printed pairing URL belongs to a room that server has registered
- **AND** a device that opens it reaches that server's approval queue and requires explicit approval of its match code

#### Scenario: Pairing command with no running server

- **WHEN** the operator runs the pairing command and no server owns the data root
- **THEN** the command fails with a message that names the missing server and prints no pairing material

#### Scenario: Approval on a headless server

- **WHEN** a device requests enrollment against a standalone server
- **THEN** the pending device name and match code are printed as a metadata-only line and the operator approves or denies with the `approve` or `deny` command over the data-root approval socket

#### Scenario: Termination signal

- **WHEN** the process receives `SIGINT` or `SIGTERM`
- **THEN** it performs bounded graceful shutdown, finalizing recordings and closing clients

#### Scenario: Unsupported native dependency

- **WHEN** a required native dependency is unsupported on the host
- **THEN** startup fails with actionable platform and architecture guidance

### Requirement: Authentication and pairing authority

Local embedded bootstrap credentials SHALL be random, short-lived, scoped to the supervised server, and never placed in normal logs or persistent URLs. Remote first pairing SHALL require the one-time URL secret plus explicit host approval of the device-bound match code, and the public server or session identifier SHALL NOT be sufficient authority. Reconnect SHALL prove possession of the registered origin-bound device key before receiving a fresh connection ticket, and the ticket SHALL be valid only on the peer that received it.

#### Scenario: Pairing with only a public identifier

- **WHEN** a client presents only the public server or session identifier
- **THEN** pairing is refused

#### Scenario: Reconnecting

- **WHEN** a registered device reconnects
- **THEN** it proves possession of its origin-bound device key before receiving a fresh connection ticket
