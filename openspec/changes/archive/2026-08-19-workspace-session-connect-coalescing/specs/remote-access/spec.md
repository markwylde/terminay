## ADDED Requirements

### Requirement: Single connection generation per mounted workspace
The mounted workspace SHALL acquire the session host's current transport generation rather than
starting its own signaling join. It SHALL subscribe to the transport or session-host lifecycle
after acquisition and SHALL ignore `closed` and `failed` events that belong to a retired
generation.

#### Scenario: Retired-generation close during hydration
- **WHEN** a `closed` event for a retired generation arrives while the workspace is first hydrating
- **THEN** it is ignored, no second connect starts, and the still-current client is not disposed

#### Scenario: No second signaling join
- **WHEN** the workspace connects
- **THEN** it acquires the session host's current generation and starts no additional signaling join

### Requirement: One handshake at a time per room or session
First mount, automatic recovery, and manual Retry SHALL share one in-flight connect attempt, so
overlapping connects are impossible. A hung attempt SHALL have a bounded deadline after which it
returns to retry-wait rather than blocking further attempts.

#### Scenario: Retry during an in-flight attempt
- **WHEN** the user presses Retry while an attempt is already in flight
- **THEN** the request is coalesced into that attempt rather than starting a competing join

#### Scenario: Hung attempt
- **WHEN** a connect attempt does not complete within its deadline
- **THEN** it ends and the workspace returns to retry-wait with Retry still available

#### Scenario: Recovery after a real failure
- **WHEN** the current generation fails and the user presses Retry
- **THEN** exactly one fresh attempt runs and live terminal input resumes without a reload

### Requirement: Connecting-surface progress reporting
The reconnecting presentation SHALL be driven by the current connect attempt. A workspace whose
client has been disposed SHALL NOT remain presented as connected.

#### Scenario: Disposed client
- **WHEN** the workspace's client is disposed while its UI is already painted
- **THEN** the surface presents reconnecting state rather than remaining marked connected
