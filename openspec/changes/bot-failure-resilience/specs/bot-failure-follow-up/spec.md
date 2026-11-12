## ADDED Requirements

### Requirement: Temporary startup failures do not wake the bot

The server SHALL NOT start a failure execution for an execution that ended before task hand-over with a final failure that is a temporary startup failure, as defined by bot-execution-resilience. Temporary attempts in the history of an execution that later failed for another reason SHALL NOT affect that failure. The failure SHALL stay visible in Sessions with its stage, its cause and its attempts, and SHALL be listed in later briefings as specified by bot-message-log.

#### Scenario: Overloaded engine exhausts retries

- **WHEN** every startup attempt of a trigger execution times out because the engine is overloaded
- **THEN** the execution ends as failed, no failure execution starts, and the next execution's briefing lists the failure as temporary with its attempt count

#### Scenario: Lasting startup failure

- **WHEN** an execution fails at the adapter check because the runtime refused its capability
- **THEN** a failure execution starts for it, as for any other execution failure

#### Scenario: Temporary attempt, then an agent failure

- **WHEN** an execution reaches hand-over on its second attempt and the agent then fails
- **THEN** a failure execution starts for it

### Requirement: Execution failures of one trigger are counted by episode

Execution failures that a trigger's executions report, including those started with Run now, SHALL be counted in episodes. Only a failure that would otherwise be accepted for a failure execution SHALL open an episode. A temporary startup failure, a failure with a blocking cause, or a failure while Investigate failures is off SHALL NOT open one. Within an open episode, only the failure that opened it SHALL be accepted.

An episode SHALL close when an execution of that trigger completes, or when the trigger is reset, disabled, resumed or deleted. Opening an episode and accepting its failure SHALL be one durable write, so a restart can neither lose nor repeat the acceptance. Failures of executions without a trigger SHALL each be accepted as before.

#### Scenario: Every-five-minutes trigger keeps failing

- **WHEN** a trigger's executions fail at 10:00, 10:05 and 10:10 for reasons that are not temporary
- **THEN** one failure execution starts, for the 10:00 failure

#### Scenario: Trigger recovers and fails again

- **WHEN** that trigger's 10:15 execution completes and its 10:20 execution fails
- **THEN** a new failure execution starts for the 10:20 failure

#### Scenario: Crash while accepting

- **WHEN** the server stops while accepting the failure that opens an episode, and then restarts
- **THEN** that failure is either accepted with its episode open, or neither is recorded and the next failure of that trigger opens the episode, and in neither case are two failures accepted for one episode

## MODIFIED Requirements

### Requirement: A bot is woken by its own failures

When **Investigate failures** is on for a bot, the server SHALL start a failure execution for that bot after any of these failures, except where the requirements below exclude it:

- one of the bot's executions ends as failed or timed out;
- one of the bot's trigger firings is recorded as failed;
- a failure episode starts for one of the bot's trigger condition checks.

The exclusions are temporary startup failures, failures with a cause that stops any execution, failures of failure executions, and failures inside an open execution episode of the same trigger. A failure execution SHALL have the *failure* origin and SHALL be started only by the server, never by another execution, by the user or by a trigger.

#### Scenario: Trigger condition starts failing

- **WHEN** a command trigger's last check was healthy and its next check exits with an error
- **THEN** a failure execution starts that names the trigger and the check's error

#### Scenario: Trigger run fails

- **WHEN** an execution started by a trigger ends as failed after hand-over, and the trigger has no open execution episode
- **THEN** exactly one failure execution starts that names the failed execution and its trigger

#### Scenario: Investigate failures is off

- **WHEN** a bot with Investigate failures off has an execution fail
- **THEN** the failure is recorded in Sessions as before and no failure execution starts

### Requirement: Failure executions are coalesced

A bot SHALL have at most one failure execution queued or running at a time. A failure that arrives while one is queued or running SHALL be added to a pending list. One failure execution SHALL start for the whole list after the current one ends. A pending list SHALL hold at most 20 failures; when it is full, later failures SHALL be counted but not listed.

#### Scenario: Burst of failures

- **WHEN** five executions of one bot, each started by a different trigger or by chat, fail within a few seconds
- **THEN** one failure execution starts for the first failure and one more starts after it ends, listing the other four

#### Scenario: Overflow

- **WHEN** 30 failures arrive while a failure execution is running
- **THEN** the next failure execution lists 20 of them and reports 10 more counted but not listed
