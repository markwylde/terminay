## MODIFIED Requirements

### Requirement: Standalone server operation

The standalone foreground command SHALL report readiness and a clear data and log location. A first-run or explicit pairing command SHALL print a short-lived secure pairing URL and SHALL require explicit host approval of each enrolling device's match code, announced as a metadata-only log line and decided through the owner-only approval socket in the data root. The runtime SHALL handle `SIGINT` and `SIGTERM` with bounded graceful shutdown that finalizes recordings, closes clients, and terminates or preserves child processes according to the session-lifetime policy. Unsupported native dependencies SHALL fail during startup with actionable platform and architecture guidance.

#### Scenario: Foreground start

- **WHEN** the standalone server starts in the foreground
- **THEN** it emits a bounded readiness record naming the data and log locations

#### Scenario: Pairing command

- **WHEN** the operator runs the pairing command
- **THEN** a short-lived secure pairing URL is printed and each enrolling device must be approved by its match code

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
