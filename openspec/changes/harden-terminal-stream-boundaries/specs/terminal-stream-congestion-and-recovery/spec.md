## MODIFIED Requirements

### Requirement: Single recovery controller and input safety

Automatic recovery and a terminal-panel retry SHALL invoke the same stable, connection-scoped recovery controller. Retry SHALL NOT call a callback captured from a retired renderer generation and SHALL NOT call attach or resume on the failed client. Once a terminal write has an uncertain outcome, including a write sent through an attachment that has since been replaced, later queued input SHALL be discarded and the panel SHALL accept no more input until a replacement client has hydrated and reattached the terminal. Recovery UI SHALL clear only after a post-recovery command can traverse the replacement endpoint.

#### Scenario: Manual retry

- **WHEN** a user presses a terminal-panel retry
- **THEN** it invokes the same connection-scoped recovery controller as automatic recovery and never calls attach or resume on the failed client

#### Scenario: Uncertain terminal write

- **WHEN** a terminal write has an uncertain outcome
- **THEN** later queued input is discarded and the panel accepts no input until a replacement client has hydrated and reattached the terminal

#### Scenario: Recovery UI clears

- **WHEN** recovery completes
- **THEN** the recovery UI clears only after a post-recovery command traverses the replacement endpoint


#### Scenario: Uncertain write during attachment replacement

- **WHEN** an in-flight write reports an unknown delivery outcome after its attachment has been replaced
- **THEN** neither that write nor its queued successors are sent to the replacement, an input interruption notice is visible, and input resumes only once the current replacement is hydrated and controls the presentation

#### Scenario: Successful or definitively refused handoff

- **WHEN** the replaced attachment confirms a write or definitively refuses it before PTY delivery
- **THEN** pending input remains ordered through hydration and only a definitively refused write is sent once by the replacement
