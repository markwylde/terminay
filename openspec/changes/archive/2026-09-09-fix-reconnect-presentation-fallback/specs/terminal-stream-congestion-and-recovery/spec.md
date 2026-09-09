## MODIFIED Requirements

### Requirement: Post-reconnect restoration

After reconnecting, the client SHALL reload the authoritative workspace snapshot, resubscribe feature projections from confirmed revisions, and reattach each mounted terminal from its confirmed position or a fresh checkpoint. Recovery SHALL use bounded retry with backoff and SHALL remain active until it succeeds, the user selects another connection, or the window closes. A failed recovery SHALL be visible and actionable and the application SHALL NOT remain silently mounted with disposed terminal clients.

A terminal whose resume from its rendered position is refused because that position is no longer within the server's retained replay window SHALL treat the refusal as a recoverable discontinuity: it SHALL request a fresh presentation through the same bounded, deadlined recovery used for a congestion skip, SHALL keep its last completed display visible meanwhile, and SHALL end hydrated at the live head. The refusal SHALL NOT be presented as a terminal error while a fresh presentation has not yet been attempted.

#### Scenario: Reconnection completes

- **WHEN** a client reconnects
- **THEN** it reloads the authoritative workspace snapshot, resubscribes projections from confirmed revisions, and reattaches each mounted terminal from its confirmed position or a fresh checkpoint

#### Scenario: Recovery keeps failing

- **WHEN** recovery repeatedly fails
- **THEN** it retries with bounded backoff and remains visible and actionable until it succeeds, another connection is selected, or the window closes

#### Scenario: Rendered position has left the replay window

- **WHEN** a terminal reattaches after a transport loss during which the shell printed more than the server retains, so its rendered position is behind the replay window
- **THEN** the server refuses the resume, the terminal requests a fresh presentation through bounded recovery, the same terminal session comes back hydrated with one panel, and new output streams afterwards

### Requirement: Recovery never waits for PTY silence

Recovery SHALL NOT wait indefinitely for complete PTY silence. A continuously updating prompt, progress display, or agent SHALL remain recoverable: the client SHALL request current bounded checkpoints on a bounded retry schedule, replace an obsolete recovery attempt when it falls behind again, and expose the most recent completed presentation while it catches up. Each attempt SHALL have a bounded deadline. A failed attempt SHALL either advance to another checkpoint or become a visible retryable error; the terminal SHALL NOT remain on an unqualified loading surface with no deadline or diagnostic transition.

A presentation-unavailable outcome on a fresh presentation SHALL be a visible retryable error whose retry requests a fresh presentation again. No recovery outcome SHALL leave a terminal on an error surface with no retry action.

#### Scenario: Continuously producing terminal recovers

- **WHEN** a terminal never becomes idle during recovery
- **THEN** bounded checkpoint attempts continue until one commits and the most recent completed presentation is exposed meanwhile

#### Scenario: Attempt exceeds its deadline

- **WHEN** a recovery attempt exceeds its bounded deadline
- **THEN** it advances to another checkpoint or becomes a visible retryable error

#### Scenario: Fresh presentation is unavailable

- **WHEN** a fresh presentation cannot be prepared for a terminal
- **THEN** the terminal shows a retryable error and its retry action requests a fresh presentation again
