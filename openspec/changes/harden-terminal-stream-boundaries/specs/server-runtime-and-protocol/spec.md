## ADDED Requirements

### Requirement: Connection-scoped concurrent command idempotency

Within a live connection's bounded command-retention window, requests naming one command identity SHALL invoke its handler at most once, including concurrent requests. Repeated results SHALL use the requesting correlation identity. Reuse with different operation, payload, expected revision, or body SHALL be rejected. Replayed outcomes SHALL NOT reapply connection delivery side effects. Retention SHALL remain bounded and connection-scoped.

#### Scenario: Concurrent duplicate command

- **WHEN** requests sharing one command identity arrive before its handler completes
- **THEN** the handler executes once and each response names its requesting correlation identity

#### Scenario: Completed duplicate command

- **WHEN** a retained completed command is requested under another correlation identity
- **THEN** its retained outcome is returned under that correlation identity without executing the handler again

### Requirement: Bounded feature admission preserves connection control

A connection SHALL bound admitted feature handlers while continuing to consume heartbeat, cancellation, and transport termination. Excess feature frames SHALL enter a FIFO bounded by bytes and frames with their original deadlines preserved. A FIFO safety-ceiling breach SHALL close the connection explicitly. Queued requests SHALL remain cancellable before execution. Feature saturation SHALL NOT alone make a live connection appear disconnected.

#### Scenario: Heartbeat under saturation

- **WHEN** every feature-handler slot is occupied and a heartbeat arrives
- **THEN** the connection answers it without waiting for a feature handler to complete

#### Scenario: Cancellation under saturation

- **WHEN** every feature-handler slot is occupied and a cancellation arrives
- **THEN** its admitted request is cancelled without waiting for another handler to finish

#### Scenario: Excess feature work

- **WHEN** a feature request arrives while handler capacity is exhausted and FIFO capacity remains
- **THEN** it waits in bounded FIFO order while heartbeat and cancellation remain serviceable

#### Scenario: Pending FIFO safety ceiling

- **WHEN** queued feature frames exhaust the FIFO byte or frame limit
- **THEN** the connection closes with a resource diagnostic rather than retaining unbounded work


### Requirement: Client feature bursts remain bounded before transmission

A client SHALL bound outstanding feature requests and captured bytes below the connection's safety capacity. Further requests SHALL wait in bounded FIFO order without blocking heartbeat or cancellation. Local queue time SHALL count against request deadlines. Cancelled or disconnected queued commands SHALL be reported as unsent and SHALL NOT cross a replacement transport generation.

#### Scenario: Desktop opens many panels

- **WHEN** a normal client submits more feature requests than the server's pending FIFO holds
- **THEN** excess work waits within the client's bounded admission queue without disconnecting the live connection

#### Scenario: A locally queued command is cancelled or disconnected

- **WHEN** a command ends before its frame is transmitted
- **THEN** the frame is discarded and the outcome is a definitive pre-send refusal, not an unknown delivery outcome
