## ADDED Requirements

### Requirement: Upgrade modal survives connection loss

While the current server's upgrade modal is visible, it SHALL remain mounted and above the connection-state presentation, including when a reconnect attempt times out and the workspace context is unavailable. Any disconnected screen SHALL remain behind the modal backdrop. Connection recovery SHALL continue normally. An upgrade outcome initiated here SHALL remain visible until closed, and closing it while disconnected SHALL expose the ordinary connection recovery controls.

#### Scenario: Restart exceeds the connection timeout

- **WHEN** the current server disconnects during an upgrade and a reconnect attempt times out
- **THEN** the upgrade card remains visible in the same position above any disconnected screen and recovery continues

#### Scenario: Outcome remains visible through another disconnect

- **WHEN** an upgrade initiated here has ended and the connection drops before its outcome card is closed
- **THEN** the outcome card remains above the disconnected screen until closed

#### Scenario: Normal recovery controls remain available

- **WHEN** no upgrade modal is visible and the server is disconnected
- **THEN** the ordinary disconnected screen and its recovery controls are visible
