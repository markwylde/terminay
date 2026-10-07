## MODIFIED Requirements

### Requirement: Transport adapter lifecycle fidelity

Transport adapters SHALL keep their reported lifecycle synchronized with the underlying channel or socket. A closing, closed, or failed underlying stream SHALL NOT be reported as writable, and concurrent close and send activity SHALL have one deterministic outcome. Reconnect SHALL establish a new connection and resume only from confirmed workspace revisions and terminal positions, and SHALL NOT reuse a half-closed transport.

A close made by either end of a transport SHALL be observed by the other end as a lifecycle change, not discovered through a liveness probe. When the embedded server closes a Desktop byte endpoint for any reason, the window's transport for that endpoint SHALL leave the open state promptly and the window SHALL begin recovery, without waiting for a heartbeat deadline.

#### Scenario: Closed underlying stream

- **WHEN** the underlying channel is closing, closed, or failed
- **THEN** the adapter does not report the transport as writable

#### Scenario: Reconnect

- **WHEN** a client reconnects
- **THEN** a new connection is established and resumption uses only confirmed workspace revisions and terminal positions

#### Scenario: The embedded server closes a window's connection

- **WHEN** the embedded server closes the connection behind a Desktop window's byte endpoint
- **THEN** that window's transport leaves the open state and recovery starts before any heartbeat deadline elapses

#### Scenario: A request sent after the far end closed

- **WHEN** a window sends a request on a Desktop byte endpoint the server has already closed
- **THEN** the request fails as a lost connection rather than waiting for a heartbeat to retire the transport

### Requirement: Structured protocol errors and resync rules

The protocol SHALL define structured errors distinguishing validation, authorization, conflict, provider or capability unavailable, incompatible extension, connection or trust, outcome-unknown, and internal failures. Reconnect and resync rules SHALL never require the client to guess whether a mutation committed.

An outcome-unknown result SHALL be resolved by the client that issued the command, after it reconnects, from the resynchronised state. A mutation that names the identity of what it creates SHALL be resolved by whether that identity exists in the resynchronised snapshot. An outcome-unknown result SHALL NOT be presented to a person as the final result of their action while the connection can still be recovered; it SHALL be presented only when resolution itself fails, and then as a plain statement of what could not be confirmed, without protocol identifiers.

#### Scenario: Authorization failure

- **WHEN** a command is rejected because the device lacks scope
- **THEN** the client receives a structured authorization error distinct from validation and conflict errors

#### Scenario: Reconnect after an in-flight mutation

- **WHEN** a client reconnects after losing transport during a mutation
- **THEN** resync determines whether that mutation committed without client guesswork

#### Scenario: An interrupted mutation that committed

- **WHEN** a client loses transport during a mutation that names what it creates, reconnects, and the resynchronised snapshot contains that identity
- **THEN** the client treats the mutation as committed and does not send it again

#### Scenario: An interrupted mutation that did not commit

- **WHEN** a client loses transport during a mutation that names what it creates, reconnects, and the resynchronised snapshot does not contain that identity
- **THEN** the client treats the mutation as not committed and may send it again with the same identity

#### Scenario: Outcome-unknown is not shown as a final result

- **WHEN** a command ends outcome-unknown while the connection is recovering
- **THEN** the person sees the action as still in progress, and sees no command or session identifier
