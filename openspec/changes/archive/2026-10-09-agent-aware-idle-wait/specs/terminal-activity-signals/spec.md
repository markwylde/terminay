## ADDED Requirements

### Requirement: Canonical terminal inactivity wait

The server SHALL own one definition of terminal inactivity, used by every inactivity wait: the macro inactivity step, the MCP `wait_for_idle` tool, and the terminal inactivity protocol query. A wait for a period SHALL resolve only when the terminal has produced no non-empty output for that whole period and no live root agent bound to that terminal is `working`. Input, resize, focus, and client attachment SHALL NOT count as output.

Only the `working` agent state SHALL hold a wait open. An agent that is `waiting`, `blocked`, `done`, or `idle` SHALL NOT hold it open. Subagent work SHALL hold a wait open only through the `working` state of its root. A terminal with no live bound agent, and a server whose agent integration is disabled, SHALL decide inactivity on output alone.

When the last working agent bound to a terminal stops working, the quiet period of every outstanding wait on that terminal SHALL start again from that moment. A wait SHALL consult only agents bound to its own terminal session; agent state in another terminal or project SHALL NOT affect it. A wait SHALL remain cancellable throughout, and terminal exit SHALL resolve it immediately whatever the agent state.

#### Scenario: Quiet terminal with no agent

- **WHEN** a wait for three seconds is outstanding on a terminal with no bound agent and the terminal produces no output for three seconds
- **THEN** the wait resolves

#### Scenario: Output restarts the quiet period

- **WHEN** a terminal produces output two seconds into a three-second wait
- **THEN** the wait does not resolve until three further seconds pass without output

#### Scenario: Working agent that prints nothing

- **WHEN** a three-second wait is outstanding and the terminal's bound agent is `working` while the terminal produces no output for ten seconds
- **THEN** the wait does not resolve during those ten seconds

#### Scenario: Agent finishes its turn

- **WHEN** a held wait's agent changes from `working` to `done` and the terminal then produces no output for the requested period
- **THEN** the wait resolves at the end of that period, measured from the later of the state change and the last output

#### Scenario: Agent asks for approval

- **WHEN** a three-second wait is outstanding, the bound agent is `waiting` for approval, and the terminal produces no output for three seconds
- **THEN** the wait resolves

#### Scenario: Agent in another terminal

- **WHEN** an agent is `working` in one terminal and a wait is outstanding on a different terminal that has been quiet for the requested period
- **THEN** the wait on the quiet terminal resolves

#### Scenario: Cancelling a held wait

- **WHEN** a wait held open by a working agent is cancelled
- **THEN** the wait ends as cancelled and the terminal and its agent are unaffected

#### Scenario: Terminal exits while held

- **WHEN** a terminal exits while a wait on it is held open by a working agent
- **THEN** the wait resolves immediately
