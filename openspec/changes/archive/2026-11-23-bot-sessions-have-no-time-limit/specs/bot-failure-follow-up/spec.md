## ADDED Requirements

### Requirement: Stopped background work is a failure

When an agent reports that it stopped its own background work because of a time limit, the server SHALL record that execution as failed with a reason saying its background work was stopped before it finished, even if the agent process exits successfully. That failure SHALL follow the normal failure follow-up rules.

#### Scenario: Agent exits cleanly after stopping a monitor

- **WHEN** an agent reports that it is stopping background tasks at a time limit and then exits with status 0
- **THEN** the execution is recorded as failed, not completed, with a reason naming the stopped background work

#### Scenario: Agent output imitates the notice

- **WHEN** a tool's output or the agent's reply contains the same words as the time-limit report
- **THEN** the execution's outcome is unaffected

### Requirement: The user is told when background work is stopped

Whatever the failure follow-up rules decide, the server SHALL post exactly one fixed notice to the bot's chat naming an execution whose background work was stopped. A notice lost to a failed write or a crash SHALL be posted when the server next reconciles, unless the chat has since been cleared.

#### Scenario: Notice write fails

- **WHEN** the notice cannot be written when the failure is recorded
- **THEN** the server posts it once at its next reconciliation

#### Scenario: Chat cleared before reconciliation

- **WHEN** the user clears the chat after the failure was recorded
- **THEN** reconciliation does not post the notice again

#### Scenario: Investigate failures is on

- **WHEN** an execution's background work is stopped and Investigate failures is on
- **THEN** a failure execution starts that names it, and one chat notice names the execution

#### Scenario: Investigate failures is off

- **WHEN** an execution's background work is stopped and Investigate failures is off
- **THEN** exactly one chat notice names the execution, and no failure execution starts

#### Scenario: Failure is suppressed by an open episode

- **WHEN** a trigger execution's background work is stopped while that trigger's failure episode is already open
- **THEN** no new failure execution starts, and one chat notice still names the execution

## MODIFIED Requirements

### Requirement: A bot is woken by its own failures

When **Investigate failures** is on for a bot, the server SHALL start a failure execution for that bot after any of these failures:

- one of the bot's executions, other than a check-in, ends as failed or timed out;
- one of the bot's trigger firings is recorded as failed;
- a failure episode starts for one of the bot's trigger condition checks.

A failure execution SHALL have the *failure* origin and SHALL be started only by the server, never by another execution, by the user or by a trigger.

#### Scenario: Trigger condition starts failing

- **WHEN** a command trigger's last check was healthy and its next check exits with an error
- **THEN** a failure execution starts that names the trigger and the check's error

#### Scenario: Trigger run fails

- **WHEN** an execution started by a trigger ends as failed
- **THEN** exactly one failure execution starts that names the failed execution and its trigger

#### Scenario: Investigate failures is off

- **WHEN** a bot with Investigate failures off has an execution fail
- **THEN** the failure is recorded in Sessions as before and no failure execution starts

#### Scenario: Check-in fails

- **WHEN** a check-in execution ends as failed
- **THEN** it appears in Sessions as failed and no failure execution starts for it
