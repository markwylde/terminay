## MODIFIED Requirements

### Requirement: Macro run queue

The macro run queue SHALL show each running macro's progress through its steps as the server reports it: the steps before the current step as completed, the current step as running, and the remaining steps as pending. The server SHALL publish a run snapshot naming the current step each time a run begins a step, as well as when the run starts and when it finishes. Finished macro runs SHALL remain visible in the run queue until the user clears them.

#### Scenario: Opening the queue during a run

- **WHEN** a macro of nine steps is running and the server is waiting for inactivity at its sixth step
- **THEN** the macro queue shows the first five steps as completed, the sixth as running, and the last three as pending

#### Scenario: Progress reaches an open queue

- **WHEN** the macro queue is open and a running macro moves from one step to the next
- **THEN** the queue shows the new step as running without being closed and reopened

#### Scenario: Step snapshot arrives before the launch response

- **WHEN** a client receives a snapshot for a run at a later step before the server's response to launching that run
- **THEN** the queue shows the later step, not the step in the launch response

#### Scenario: Clearing finished runs

- **WHEN** the user clears finished runs from the macro queue
- **THEN** those completed entries are removed from the queue
