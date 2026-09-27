## MODIFIED Requirements

### Requirement: Automation authority

Creating, editing, enabling, running, and deleting automations SHALL require the same authority on the owning server as creating a terminal there, and SHALL be refused to any client, device, or extension without it. An MCP caller SHALL manage automations only through the MCP automation tools. Those tools SHALL be evaluated against the MCP permission policy, and a caller SHALL be permitted only when the policy allows it or a user with terminal-create authority on the server approves it. The server SHALL revalidate authority on every request and SHALL NEVER infer it from UI focus or renderer state.

#### Scenario: MCP caller attempts to create an automation

- **WHEN** a process with an MCP capability presents it to the client automation operations instead of the MCP automation tools
- **THEN** the request is refused and nothing is created

#### Scenario: MCP caller creates an automation with approval

- **WHEN** an agent calls `create_automation`, Full Automation Management is Ask Permission, and the user chooses Allow One Time
- **THEN** the automation is created

#### Scenario: MCP caller denied

- **WHEN** an agent calls `create_automation` and Full Automation Management is Never Allow
- **THEN** nothing is created and the caller receives `permission_denied`

#### Scenario: Client without terminal authority

- **WHEN** a client without authority to create terminals on a server attempts to save an automation there
- **THEN** the request is refused

### Requirement: Run log

The server SHALL keep a bounded log of automation runs, retaining at least the most recent 100 runs per automation and dropping the oldest first. Each entry SHALL record the automation, the trigger kind and fire time, the subject, whether it was started by a trigger, by a user, or by an agent through MCP, the outcome — succeeded, failed with exit code, timed out, stopped, or skipped with a reason — the duration, and a bounded tail of the run terminal's final output. The log SHALL be server-owned, SHALL survive restart, and SHALL be available to clients that have authority over automations.

#### Scenario: Output tail after the terminal closed

- **WHEN** a user opens a finished run whose terminal has closed
- **THEN** the run's outcome, exit code, duration, and final output tail are shown

#### Scenario: Log bound

- **WHEN** an automation has run 150 times
- **THEN** its oldest runs are dropped and at least its latest 100 remain

#### Scenario: Run started by an agent

- **WHEN** an agent starts a run with `run_automation`
- **THEN** the run is logged as started by an agent through MCP
