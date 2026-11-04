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


### Requirement: Attach-time gaps do not re-arm hydration

A gap established during attach SHALL NOT immediately re-arm hydration. After the attachment has rendered, an unresolved hydration gap SHALL receive a bounded fresh-checkpoint refresh once live output becomes quiet. Continued output SHALL defer that refresh. Refreshes SHALL use the existing recovery controller and scoped attachment handoff, preserve input safety, and never advance a rendered cursor across skipped bytes. Repeated incomplete refreshes SHALL end in a visible retryable error rather than silent stale presentation.

#### Scenario: Hydration gap followed by silence

- **WHEN** hydration restores an older checkpoint, skips its catch-up range, and output then stops
- **THEN** a bounded quiet-period refresh restores a current checkpoint even without further PTY output

#### Scenario: Sustained output during hydration catch-up

- **WHEN** output keeps arriving after a hydration skip
- **THEN** each output defers convergence refresh and no immediate hydration loop starts

#### Scenario: Convergence exhausts its retry budget

- **WHEN** bounded quiet-period refreshes repeatedly return incomplete presentation
- **THEN** the panel shows a retryable recovery error instead of appearing healthy indefinitely

#### Scenario: Gap during attach

- **WHEN** a gap is established while a display is attaching
- **THEN** hydration does not immediately re-arm and the display paints, retaining bounded quiet-period convergence for an unresolved hydration skip

#### Scenario: Live display falls behind

- **WHEN** a live streaming display falls behind
- **THEN** it re-hydrates

#### Scenario: Rebind during convergence

- **WHEN** a display with unresolved hydration debt resumes on a replacement connection
- **THEN** debt survives the rebind and a bounded quiet refresh remains scheduled after the replacement hydrates

#### Scenario: Terminal exits during convergence

- **WHEN** a PTY exits before its pending quiet refresh
- **THEN** automatic convergence is cancelled and the terminal's ended presentation is retained

#### Scenario: Explicit retry after convergence exhaustion

- **WHEN** the user retries after convergence exhausts
- **THEN** the panel requests a fresh checkpoint with a renewed bounded refresh budget instead of resuming a stale presentation
