## MODIFIED Requirements

### Requirement: Claude bot approvals survive background work

The server SHALL keep a Claude Code bot execution's approval channel available while background work continues and while the agent handles its wake-up, until the server closes the agent's input: when nothing is pending, or after the agent says it is done in answer to a done check (`bot-background-wait`). A request made after such an answer SHALL be refused. Tool requests after a wake-up SHALL follow the execution's approval mode and existing runtime authority.

#### Scenario: Background work continues after an interim result
- **WHEN** a Claude Code bot reports a result while background work continues
- **THEN** the execution stays running and can respond to background notifications

#### Scenario: A task ends before Claude emits an interim result
- **WHEN** background tasks have ended and Claude reports a result while their wake-ups are queued
- **THEN** the approval channel stays available through those follow-up turns

#### Scenario: Background work and its follow-up both finish
- **WHEN** the last background task ends and Claude finishes handling its notification
- **THEN** the server closes the agent's input after its final result and waits for process exit before completing the execution

#### Scenario: Claude says it is done while background work continues
- **WHEN** a Claude Code bot says it is done in answer to a done check
- **THEN** the server stops its background tasks, closes the agent's input and completes the execution

#### Scenario: Claude finishes without background work
- **WHEN** Claude returns a result with no active background work or queued wake-ups
- **THEN** the server closes the agent's input and waits for process exit before completing the execution

#### Scenario: Background work wakes an Autonomous bot
- **WHEN** a Claude Code bot returns an interim result while background work is active and later asks for approval to write a file or invoke a runtime chat tool
- **THEN** the server answers the request using the Autonomous approval policy and the approved tool can run

#### Scenario: Background work wakes an Ask me bot
- **WHEN** a Claude Code bot asks for approval after a background wake-up in Ask me mode
- **THEN** the server presents the request to the user and relays the user's decision to the agent

#### Scenario: Approval channel closes unexpectedly
- **WHEN** Claude reports that its host approval stream closed during a tool permission request and exits cleanly
- **THEN** the server records a failed execution and retains the tool failure in the session diagnostics

