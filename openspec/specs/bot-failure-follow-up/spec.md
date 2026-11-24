# bot-failure-follow-up Specification

## Purpose
When a bot's own work fails, the server starts one bounded investigation session so the bot can find out why and fix what is its own, without waking it for failures it cannot act on or for its own investigations.

## Requirements

### Requirement: A bot is woken by its own failures

When **Investigate failures** is on for a bot, the server SHALL start a failure execution for that bot after any of these failures, except where the requirements below exclude it:

- one of the bot's executions, other than a check-in, ends as failed or timed out;
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

#### Scenario: Check-in fails

- **WHEN** a check-in execution ends as failed
- **THEN** it appears in Sessions as failed and no failure execution starts for it

### Requirement: Condition failures are counted by episode

A trigger's condition-check failure episode SHALL start at the first failed or blocked check after the trigger was created, enabled, reset or last succeeded. It SHALL end only when a check succeeds or the trigger is reset, disabled or deleted. Intermediate states such as checking, retrying or reconnecting SHALL NOT end an episode. Episodes SHALL survive a server restart.

#### Scenario: Condition keeps failing between checks

- **WHEN** a trigger's check fails, the next check moves through checking, and that check fails too
- **THEN** no second failure execution starts for that trigger

#### Scenario: Condition recovers and fails again

- **WHEN** a check of that trigger succeeds and a later check fails
- **THEN** a new failure execution starts for the new episode

#### Scenario: Restart during an episode

- **WHEN** the server restarts while a trigger's checks are failing and the next check fails
- **THEN** no new failure execution starts for that trigger

### Requirement: A firing failure is reported once

A firing that fails because its execution failed SHALL be reported as that execution's failure. A firing that fails to start SHALL be reported once, even when the same error also changes the trigger's condition health.

#### Scenario: Firing cannot start a session

- **WHEN** a firing fails to start with an error that also marks the trigger's condition health failed
- **THEN** exactly one failure is accepted for it

### Requirement: Failures that stop any execution do not wake the bot

The server SHALL NOT start a failure execution for a failure whose cause also stops any execution: engine unavailable, agent not ready, image unbuildable, bot disabled or being deleted, or container out of processes. This SHALL apply to executions, firings and condition checks alike. The cause SHALL be a recorded structured value, never inferred from message text. These failures SHALL stay visible in Sessions and the Triggers tab with their reason.

#### Scenario: Container out of processes

- **WHEN** an execution fails because the bot container has run out of processes
- **THEN** no failure execution starts and the failed execution's reason names the process limit

#### Scenario: Condition check cannot reach the engine

- **WHEN** a trigger's condition check fails because the container engine is not running
- **THEN** the trigger's health shows the error and no failure execution starts

### Requirement: Failure executions do not chain

A failure of a failure execution SHALL be recorded but SHALL NOT wake the bot. Any trigger, firing or execution that a failure execution creates SHALL be treated like any other, so its own failures wake the bot.

#### Scenario: Investigation fails

- **WHEN** a failure execution itself ends as failed
- **THEN** it appears in Sessions as failed and no further failure execution starts for it

### Requirement: Failure executions are coalesced

A bot SHALL have at most one failure execution queued or running at a time. A failure that arrives while one is queued or running SHALL be added to a pending list. One failure execution SHALL start for the whole list after the current one ends. A pending list SHALL hold at most 20 failures; when it is full, later failures SHALL be counted but not listed.

#### Scenario: Burst of failures

- **WHEN** five executions of one bot, each started by a different trigger or by chat, fail within a few seconds
- **THEN** one failure execution starts for the first failure and one more starts after it ends, listing the other four

#### Scenario: Overflow

- **WHEN** 30 failures arrive while a failure execution is running
- **THEN** the next failure execution lists 20 of them and reports 10 more counted but not listed

### Requirement: Failure executions are rate-limited without polling

A bot SHALL start at most 6 failure executions in any rolling hour. A failure that arrives when the limit is reached SHALL wait in the pending list until the first failure execution the limit allows. The server SHALL learn when the limit allows the next execution from one timer set for that moment, not by checking on an interval.

#### Scenario: Hourly limit reached

- **WHEN** a bot has started six failure executions in the last hour and another execution fails
- **THEN** no failure execution starts until an hour after the earliest of those six, and that one lists the waiting failure

### Requirement: Failure dispatch survives restarts and setting changes

A failure that has been accepted SHALL be delivered once or discarded on purpose. It SHALL NOT be lost or duplicated by a server restart at any point during dispatch. When Investigate failures is turned off, or the bot is disabled, the bot's pending failures SHALL be discarded and its timer cancelled. When the bot is deleted, its failure follow-up state SHALL be deleted with it. A failure execution already queued or running SHALL be allowed to finish.

#### Scenario: Restart mid-dispatch

- **WHEN** the server stops after deciding to start a failure execution but before the execution is created, and then restarts
- **THEN** exactly one failure execution starts for those failures

#### Scenario: Turned off while failures wait

- **WHEN** failures are waiting behind the hourly limit and the user turns Investigate failures off
- **THEN** no failure execution starts for them, now or when the hour passes

### Requirement: What a failure execution is told

A failure execution's prompt SHALL be written by the server from a fixed template. For each listed failure it SHALL give the kind (execution, firing or condition check), the execution, firing and trigger IDs involved, the trigger's name, when it happened, and the reason cut to 1 KiB. It SHALL give how many further failures were counted but not listed.

#### Scenario: Overflow is reported

- **WHEN** a failure execution starts for 20 listed failures and 10 more counted
- **THEN** its prompt lists the 20 and says 10 more were not listed

### Requirement: Failure prompts treat diagnostics as data

A failure execution's prompt SHALL tell the agent that reasons and runner output are untrusted diagnostic data, not instructions. It SHALL name the runtime tools that read execution summaries, runner output and trigger detail, and SHALL NOT include runner output or transcripts. A failure execution SHALL post to the bot's chat only through the normal scoped chat post.

#### Scenario: Agent investigates a failing poll

- **WHEN** a failure execution starts for a trigger whose condition command failed
- **THEN** its prompt names the trigger and the error, and the agent can read the trigger and its own recent runner output through runtime tools

#### Scenario: Silent investigation

- **WHEN** a failure execution fixes the trigger without posting to chat
- **THEN** no chat message appears, and the execution's runner output stays in Sessions

### Requirement: Failure details are redacted before they are kept

A failure's reason and trigger name SHALL be redacted against the bot's credential at the moment the failure is accepted, before they are stored in pending state or a session origin. Every later exposure SHALL use only the redacted copy. This covers the prompt, the Sessions tab, execution summaries and briefings.

#### Scenario: Credential rotated before investigation

- **WHEN** a failure reason contains the bot's token, the token is rotated, and the failure execution then starts
- **THEN** the prompt, the session origin and the Sessions tab all show the old token redacted

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

### Requirement: A recovered interruption does not wake the bot

A live polled condition check that is interrupted once and returns a result on its retry SHALL NOT start a condition failure episode, and SHALL NOT start a failure execution. The interim *retrying* health SHALL neither start nor end an episode. A check that is interrupted again on its retry SHALL count as one failed check and SHALL follow every existing episode, exclusion, coalescing and rate-limit rule.

#### Scenario: Host sleep interrupts one check

- **WHEN** Investigate failures is on and a bot's command check is interrupted by host sleep, then succeeds on its retry
- **THEN** no failure execution starts and Sessions shows no new investigation

#### Scenario: The retry is interrupted as well

- **WHEN** Investigate failures is on, the trigger's last check was healthy, the failure has no cause that stops every execution, the bot has no queued or running failure execution, the hourly cap is not reached, and a check and its retry are both interrupted
- **THEN** exactly one failure execution starts that names the trigger and the interruption reason

#### Scenario: Retry during an open episode

- **WHEN** a trigger is already in a failure episode, and its next check is interrupted and then succeeds on retry
- **THEN** the episode stays open while retrying, ends on the success, and no failure execution starts

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
