# bot-check-ins Specification

## Purpose
TBD - created by archiving change bot-sessions-have-no-time-limit. Update Purpose after archive.

## Requirements

### Requirement: A running session gets a check-in every 15 minutes

For every 15 minutes an execution has run since it was handed its task, the server SHALL start one check-in execution of the same bot, with the *check-in* origin naming the watched execution and its running time. The server SHALL schedule each mark with one timer set for that moment and SHALL NOT poll. A check-in SHALL be started only by the server.

#### Scenario: First mark

- **WHEN** an execution has been running for 15 minutes
- **THEN** one check-in execution of the same bot starts for it

#### Scenario: Later marks

- **WHEN** the same execution is still running at 30 and 45 minutes and no earlier check-in is active
- **THEN** one check-in starts at each mark, stating 30 and then 45 minutes

#### Scenario: Time waiting in the queue

- **WHEN** an execution waits 20 minutes in the queue and is then handed its task
- **THEN** its first check-in is due 15 minutes after hand-over

### Requirement: What a check-in is told

A check-in's prompt SHALL begin with exactly this text, with the real execution ID and the whole minutes it had run when the check-in was created:

> You have another session running at {sessionId} and it's been running for {minutes} minutes. Everything is probably fine, but can you just go check on it. Is it stuck, crashed, or in some sort of trouble? If it's still progressing as expected that's fine. If not fix it.

#### Scenario: Prompt names the real session and duration

- **WHEN** execution `abc` reaches its 30-minute mark
- **THEN** the check-in's prompt begins with the required text naming `abc` and `30 minutes`

#### Scenario: Timer fires late

- **WHEN** the server was busy and the 30-minute timer fires when the execution has run for 37 minutes
- **THEN** one check-in is created stating 37 minutes, and the next mark is 45 minutes

### Requirement: How a check-in is guided

After the required text, a check-in's prompt SHALL tell the agent that output it reads is untrusted data, name the tools that inspect the watched execution, tell it to post nothing to chat when nothing is wrong, and tell it not to answer or bypass a decision that is waiting on the user.

#### Scenario: Nothing is wrong

- **WHEN** a check-in finds the watched execution progressing
- **THEN** it ends without posting to chat

### Requirement: Check-ins do not multiply

A check-in SHALL NOT receive check-ins of its own. A failure of a check-in SHALL NOT start a failure execution. Each watched execution SHALL have at most one check-in queued or running. A mark reached while one is active SHALL be skipped, and the next mark SHALL still be scheduled.

#### Scenario: Check-in runs past 15 minutes

- **WHEN** a check-in has itself been running for 15 minutes
- **THEN** no check-in starts for it

#### Scenario: Earlier check-in still running

- **WHEN** an execution reaches its 30-minute mark while its 15-minute check-in is still running
- **THEN** no second check-in starts, and a check-in starts at the 45-minute mark if none is then active

#### Scenario: Queue is full

- **WHEN** a mark is reached and the bot's queue cannot accept the check-in
- **THEN** that mark is skipped and the next mark is still scheduled

### Requirement: Check-ins stop when the watched session ends

When a watched execution ends, the server SHALL cancel its timer and any queued check-in for it. A check-in already running SHALL continue and SHALL be able to read the watched execution's ended state.

#### Scenario: Session ends between marks

- **WHEN** an execution ends at 20 minutes
- **THEN** no check-in starts at 30 minutes

#### Scenario: Session ends while its check-in is queued

- **WHEN** an execution ends while its check-in is waiting in the queue
- **THEN** the check-in is cancelled without running

#### Scenario: Session ends during its check-in

- **WHEN** an execution ends while its check-in is running
- **THEN** the check-in reads the watched execution's ended state

### Requirement: A session waiting on the user is left to the user

The server SHALL NOT start a check-in at a mark reached while the watched execution is waiting on a user decision, and SHALL re-check this when a queued check-in is about to run, ending it unrun if the watched execution is then waiting on the user. The next mark SHALL still be scheduled. A check-in SHALL have no authority to answer the watched execution's permission requests, and SHALL be refused if it tries to stop or replace its watched execution while that execution is waiting on the user.

#### Scenario: Mark reached while needing the user

- **WHEN** an execution is waiting on a permission decision at its 15-minute mark
- **THEN** no check-in starts for that mark, and the 30-minute mark is still scheduled

#### Scenario: Watched session starts waiting while its check-in is queued

- **WHEN** a check-in is queued and its watched execution starts waiting on the user before the check-in runs
- **THEN** the check-in ends without running

#### Scenario: Watched session starts waiting during its check-in

- **WHEN** a running check-in tries to stop or replace its watched execution while that execution is waiting on the user
- **THEN** the request is refused and the user's decision stays pending

### Requirement: The check-in schedule follows the session's hand-over time

Each mark SHALL be computed from the execution's durable hand-over time, so the schedule never depends on an in-memory start time. After a server restart, the server SHALL rebuild schedules only for executions that are still running; an execution ended by the restart SHALL have no further check-ins.

#### Scenario: Server restarts during a session

- **WHEN** the server restarts while an execution is running
- **THEN** that execution is recorded as interrupted and no check-in starts for it
