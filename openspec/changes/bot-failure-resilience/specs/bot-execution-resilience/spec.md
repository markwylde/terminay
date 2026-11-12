## ADDED Requirements

### Requirement: Task hand-over is recorded before the agent receives it

The server SHALL durably record the moment it hands an execution its task, before it sends the task to the agent. An execution SHALL count as *started work* from that moment, whether or not the agent answered. An execution that has not reached that moment SHALL count as not having started work. A crash between recording and sending SHALL leave the execution counted as having started work.

#### Scenario: Failure before the task is sent

- **WHEN** an execution fails while its terminay_bot adapter check is running
- **THEN** its record shows no task hand-over and it counts as not having started work

#### Scenario: Failure after the task is sent

- **WHEN** an execution fails after the agent received its prompt but before the agent produced any output
- **THEN** its record shows the hand-over time and it counts as having started work

### Requirement: Startup failures are recorded as structured facts

A failed startup attempt SHALL record the stage that failed (environment preparation, agent check, relay start, adapter check or agent launch) and whether the failure is temporary. A failure SHALL be temporary exactly when its structured error is an engine operation deadline, a dropped or reset engine connection, a relay that did not become ready or closed before readiness, or an adapter check that timed out or exited with its temporary status. The classification SHALL use structured error values and exit statuses, never message text. A temporary failure SHALL NOT set the blocking failure `cause` and SHALL NOT stop other executions. A failure that has a blocking cause SHALL keep it and SHALL NOT be temporary.

#### Scenario: Overloaded engine

- **WHEN** the adapter check does not finish within its deadline because the engine is overloaded
- **THEN** the attempt records a temporary failure at the adapter-check stage, and the bot is not blocked

#### Scenario: Engine not running

- **WHEN** an execution cannot start because the container engine is not running
- **THEN** it records the blocking engine cause, and the failure is not temporary

#### Scenario: Adapter refuses the capability

- **WHEN** the adapter check exits with its lasting status because the runtime refused its capability
- **THEN** the attempt records a failure at the adapter-check stage that is not temporary

### Requirement: Attempt history is separate from the final failure

Each failed startup attempt SHALL be kept in the execution's attempt history. An execution's final failure SHALL describe only why the execution ended. It SHALL be a startup failure only when the execution ended before task hand-over. An execution that reached hand-over after earlier temporary attempts SHALL NOT carry a startup failure as its final failure, and its later failure SHALL be classified on its own.

#### Scenario: Recovered startup, then a real failure

- **WHEN** an execution's first attempt fails temporarily, its second reaches hand-over, and the agent then fails
- **THEN** its history shows one temporary attempt, its final failure is the agent failure, and it is treated as an ordinary execution failure

### Requirement: Temporary startup failures are retried within the execution

An execution whose attempt fails temporarily during environment preparation, the agent check, relay start or the adapter check SHALL end that attempt first: its relay and its runtime token. It SHALL retry only when container-side cleanup of that attempt is confirmed. If cleanup cannot be confirmed, the execution SHALL end as failed and record the cleanup failure under the existing cleanup policy. A failure at agent launch SHALL be recorded with its stage and SHALL NOT be retried, so no provider runs in an attempt that is retried. A retry SHALL wait about 10, 30 and then 60 seconds, each varied by up to a fifth, and SHALL use a fresh relay and a fresh runtime token. Calls that use an earlier attempt's runtime token SHALL be refused. Each failed attempt SHALL add one Runner output line naming the attempt, the stage and the cause. The wait SHALL be one timer and SHALL NOT poll.

#### Scenario: Second attempt succeeds

- **WHEN** a trigger execution's first attempt times out in the adapter check and its second attempt starts normally
- **THEN** the execution completes, and its Runner output and history show one failed attempt before it

#### Scenario: Cleanup cannot be confirmed

- **WHEN** a temporary attempt fails and its relay process group cannot be confirmed ended
- **THEN** the execution ends as failed with a recorded cleanup failure and makes no further attempt

#### Scenario: Late call from the first attempt

- **WHEN** a call arrives with the first attempt's runtime token after the second attempt started
- **THEN** it is refused and does not change the second attempt or the execution's state

#### Scenario: Agent launch fails

- **WHEN** an execution's agent process cannot be launched
- **THEN** the execution ends as failed at the agent-launch stage without a retry

#### Scenario: Failure after hand-over

- **WHEN** an execution's agent connection drops after its task was handed over
- **THEN** the execution ends as failed and is not retried

#### Scenario: Stopped while waiting

- **WHEN** the user stops an execution that is waiting for its next startup attempt
- **THEN** no further attempt starts and the execution ends as stopped

### Requirement: Retry limit

A trigger or Run now execution SHALL take its retry limit from its trigger's Startup retries setting when the execution is created. Every other execution SHALL use a limit of 3. When an execution has used its limit, it SHALL end as failed with its last startup failure.

#### Scenario: Retries exhausted

- **WHEN** all four attempts of an execution with Startup retries 3 fail temporarily
- **THEN** the execution ends as failed with its last startup failure, and Sessions shows four attempts

#### Scenario: Retries turned off

- **WHEN** a trigger with Startup retries 0 has a temporary startup failure
- **THEN** its execution ends as failed without a second attempt

### Requirement: Retries end before the deadline

Every execution SHALL have a retry deadline: 5 minutes after its first attempt began, or its trigger's next due firing if that is earlier. An attempt SHALL begin only before the deadline. The server SHALL check this when it schedules a retry and again when a startup slot is granted. An execution that cannot begin its next attempt before the deadline SHALL end as failed with its last startup failure. A server restart SHALL end an execution that waits for a retry or a startup slot as interrupted, and SHALL NOT resume it.

#### Scenario: Hourly trigger

- **WHEN** an hourly trigger's execution fails temporarily three times within two minutes
- **THEN** all three retries run, and the next hourly firing starts its own fresh execution

#### Scenario: Next firing is close

- **WHEN** a trigger due again in 20 seconds has an execution whose next retry is 30 seconds away
- **THEN** that execution ends as failed without retrying

#### Scenario: Slot granted too late

- **WHEN** an execution's retry waits for a startup slot and the slot is granted after its deadline
- **THEN** it ends as failed without beginning the attempt

#### Scenario: Chat message

- **WHEN** a chat execution keeps failing temporarily
- **THEN** it begins no attempt more than 5 minutes after its first

### Requirement: The next firing replaces an execution that has not started work

When a trigger's next firing is due while that trigger's previous execution has not reached hand-over, the server SHALL act on the previous execution's state:

- **Waiting for a retry or a startup slot:** the server SHALL end it as failed with the reason "replaced by the next firing", release its admission, and let the new firing proceed.
- **Attempt in progress:** the attempt SHALL be allowed to finish. If it reaches hand-over, the new firing SHALL be skipped as bot busy. If it fails, the execution SHALL end as failed without a retry, and the new firing SHALL then proceed.

#### Scenario: Next firing during a retry wait

- **WHEN** an every-5-minutes trigger comes due while its previous execution waits 60 seconds for a retry
- **THEN** the previous execution ends as failed, replaced by the next firing, and the new firing starts a fresh execution

#### Scenario: Next firing during an attempt

- **WHEN** a trigger comes due while its previous execution's second attempt is checking the adapter, and that attempt succeeds
- **THEN** the previous execution continues and the new firing is skipped as bot busy

### Requirement: Machine-wide startup budget

At most two executions on a server SHALL be in startup at the same time, across all bots. Startup runs from environment preparation to task hand-over. An execution waiting for a startup slot or for a retry SHALL keep its admission place, SHALL show as running, and SHALL say in Runner output that it is waiting. A slot SHALL be released at hand-over, at failure, on stop, or when its execution starts waiting for a retry. Slots SHALL be granted in request order.

#### Scenario: Three bots start at once

- **WHEN** three bots each start an execution at the same moment
- **THEN** two start at once, and the third starts when one of the first two hands over its task or fails

#### Scenario: Waiting for a retry frees the slot

- **WHEN** an execution's attempt fails temporarily and it waits 10 seconds to retry
- **THEN** another execution waiting for a startup slot can use that slot during those 10 seconds

### Requirement: A bot reports the outcome it judged

A live execution SHALL be able to report one outcome through the `outcome_report` runtime tool:

- `outside-control`: the problem is outside the bot's control;
- `needs-human`: the bot is blocked until a human acts;
- `fixed`: the bot fixed what was its own.

The reason SHALL be at most 512 bytes of UTF-8. `needs-human` SHALL also require an action of at most 512 bytes that says what the human must do. The tool SHALL accept an optional ID of one of the calling bot's own triggers. Without one, the trigger SHALL be the one that started the execution, if any. A report that names a trigger, or that would change one, SHALL carry the trigger revision the execution observed, and a stale revision SHALL be refused as a conflict. The outcome SHALL be stored on the execution after redaction and shown in Sessions. A later report SHALL replace an earlier one.

#### Scenario: Overload judged outside control

- **WHEN** a failure execution reports `outside-control` with the reason "host engine overloaded"
- **THEN** the outcome is stored on that execution, nothing is posted, and no trigger changes

#### Scenario: Password needed

- **WHEN** an hourly support-ticket trigger's execution reports `needs-human` with the action "Add the support portal password to the bot's secrets"
- **THEN** the trigger shows Needs you with that action, and one bot message with the reason and action is posted, which raises a notification

#### Scenario: Stale revision

- **WHEN** an execution reports `fixed` for a trigger with a revision older than the trigger's current one
- **THEN** the report is refused as a conflict and the trigger's blocker stays

#### Scenario: Another bot's trigger

- **WHEN** an execution reports an outcome naming a trigger of another bot
- **THEN** the report is refused as not found and no trigger changes

### Requirement: Needing a human is reported once per block

A `needs-human` report for a trigger that has no blocker SHALL record one, with the reason, the action, the reporting execution, the time and a pending notice. It SHALL then post one bot message, with an idempotency key derived from the blocker, and mark the notice posted. After a restart, a pending notice SHALL be posted with the same key, so exactly one message appears. Reports for the same bot SHALL be applied one at a time. A report for a trigger that already has a blocker SHALL update its reason and action without posting. A report without a trigger SHALL post once per execution and record no blocker. `fixed` SHALL clear the trigger's blocker.

#### Scenario: Keep-running trigger asks again

- **WHEN** a trigger set to Keep running has a blocker and its next execution also reports `needs-human`
- **THEN** no second message is posted and the trigger still shows Needs you

#### Scenario: Crash before the post

- **WHEN** the server stops after recording a blocker and before posting its message, and then restarts
- **THEN** exactly one message for that blocker is posted

#### Scenario: Two executions report together

- **WHEN** two executions of one trigger report `needs-human` at the same moment
- **THEN** one blocker is recorded and one message is posted

#### Scenario: Bot fixes it after the user replies

- **WHEN** the user sends the missing password in chat and the chat execution reports `fixed`, naming that trigger with its current revision
- **THEN** the trigger's blocker clears and, if it was paused, it fires again at its next due time

#### Scenario: Chat execution needs a human

- **WHEN** a chat execution reports `needs-human` without naming a trigger
- **THEN** one bot message with the reason and action is posted and no trigger changes
