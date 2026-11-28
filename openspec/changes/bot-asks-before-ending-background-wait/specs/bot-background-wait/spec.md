## ADDED Requirements

### Requirement: Executions are told to stop their background work

Every execution's instructions SHALL tell the agent that, before it finishes, it must stop any background tasks it started: shells, Monitors, scheduled wakeups and background subagents.

#### Scenario: Instructions carry the cleanup rule

- **WHEN** an execution of any origin receives its instructions
- **THEN** they tell it to stop its background shells, Monitors, scheduled wakeups and background subagents before it finishes

### Requirement: A waiting execution is asked whether it is done

A Claude Code execution is in background-wait when its turn has ended and the server keeps the agent's input open because background work or a follow-up turn is still pending. When an execution of any origin, including a check-in, has been in background-wait for 5 continuous minutes, the server SHALL send that same agent one message asking whether it is done. The message SHALL list what the server sees pending, SHALL give a one-time line to reply with if the task is completely finished, and SHALL say that otherwise the session keeps running. A new turn SHALL end the wait, and the 5 minutes SHALL start again when that turn ends in background-wait. The server SHALL NOT ask while a permission request of the execution is unanswered. A check SHALL NOT cause a pending follow-up turn to be counted as handled, in whichever order the two turns start.

#### Scenario: Waiting for five minutes

- **WHEN** an execution has been in background-wait for 5 minutes
- **THEN** its agent receives one done check, and the check appears in the session transcript

#### Scenario: Check-in left waiting

- **WHEN** a check-in execution has been in background-wait for 5 minutes
- **THEN** it receives the same done check

#### Scenario: Woken before five minutes

- **WHEN** background work starts a new turn 4 minutes into the wait
- **THEN** no check is sent for that wait, and the next is due 5 minutes after that turn ends in background-wait

#### Scenario: Notification arrives with the check

- **WHEN** a background notification's follow-up turn and the check's turn start in either order
- **THEN** the agent's input stays open until both turns have run

#### Scenario: Permission is waiting on the user

- **WHEN** 5 minutes pass while a permission request of the execution is unanswered
- **THEN** no check is sent, and the server looks again 5 minutes later

#### Scenario: Finished without background work

- **WHEN** a turn ends with nothing pending
- **THEN** the execution completes without a done check

### Requirement: Only the agent's answer ends a waiting execution

When a turn's final reply contains, on its own line, the one-time line from the latest done check, and the turn succeeded, the server SHALL stop the execution's background tasks, including any that appear while it stops them, close the agent and record the execution as completed, without any user action. If the agent has not exited 30 seconds after that reply, the server SHALL end its process group.

Once the line is accepted, only these change the outcome: an error the execution had already recorded when it answered, which makes it failed; a report that the agent stopped background work at a time limit; a user, bot or server stop that arrives before the outcome is recorded; and unconfirmed process cleanup, which follows the usual cleanup-failure rules. Errors from turns that stopping the tasks causes, a permission request made then (which is refused), and the agent's exit status SHALL NOT. Without that line, an execution with work still pending SHALL keep running, and the server SHALL ask again after each further 5 minutes of background-wait, with a new one-time line. A turn after which nothing is pending completes the execution in the usual way, whatever it says. The server SHALL NOT end an execution because of how long it has waited or how many times it has been asked.

#### Scenario: Agent says it is done

- **WHEN** an execution holding a Monitor, a background shell and a background subagent replies with the latest check's line
- **THEN** the server stops those tasks and the execution ends as completed

#### Scenario: Agent is still waiting

- **WHEN** the agent replies that it is still waiting for a build
- **THEN** the execution stays running, its background tasks keep running, and it is asked again 5 minutes after that reply

#### Scenario: Work ends by itself after a check

- **WHEN** the agent answers a check without the line, and later its last background task ends and it finishes handling that
- **THEN** the execution completes without needing the line

#### Scenario: Check gets no reply

- **WHEN** no new turn starts within 5 minutes of a check
- **THEN** the execution stays running and the server asks again

#### Scenario: Old or imitated line

- **WHEN** a reply contains an earlier check's line, or the latest line appears only in tool output or inside a sentence
- **THEN** the execution keeps running

#### Scenario: Agent does not exit after saying done

- **WHEN** the agent is still running 30 seconds after saying it is done
- **THEN** the server ends its process group and the execution is completed

#### Scenario: Stopping a task causes another turn

- **WHEN** after the accepted line, stopping a task wakes the agent into a turn that asks for permission and ends in an error
- **THEN** the request is refused and the execution is completed

#### Scenario: Error before the answer

- **WHEN** an earlier turn of the execution ended in an error and a later turn replies with the line
- **THEN** the background tasks are stopped and the execution is failed

#### Scenario: Cleanup cannot be confirmed

- **WHEN** the line is accepted and the execution's process group cannot be confirmed gone
- **THEN** the execution is handled as any other answered turn whose cleanup failed, including the bot's cleanup-failure threshold

#### Scenario: User stops while it shuts down

- **WHEN** a user stops the execution after the line is accepted and before the outcome is recorded
- **THEN** it is recorded as stopped

#### Scenario: Waiting for hours

- **WHEN** an execution has answered every check for several hours that it is still waiting
- **THEN** it is still running

#### Scenario: Stopped by the user during a wait

- **WHEN** a user stops an execution in background-wait
- **THEN** it is recorded as stopped and no further check is sent

### Requirement: A background wait can be diagnosed

An execution that has been in background-wait SHALL record: whether it is waiting now and since when; the background items last seen holding it open, each with its identifier, kind and description; the number of follow-up turns still expected; when it last produced activity; how many done checks it was sent, when the last one was sent and how the agent answered. The record SHALL be redacted with the bot's secrets, SHALL hold at most 32 items with descriptions of at most 256 bytes, saying how many more there were, and SHALL be kept after the execution ends. The session details SHALL show it. `sessions_get` SHALL return it with at most the first 8 items, each description cut to 128 bytes, and the number of items left out; it SHALL leave out further items as needed to keep the whole result within the tool's size limit, and SHALL keep the execution's other facts.

#### Scenario: Looking at a held session

- **WHEN** a user opens the details of an execution waiting on a Monitor
- **THEN** they see that background work is holding it open, the Monitor's description, its last activity and the checks so far

#### Scenario: Held by a follow-up turn only

- **WHEN** an execution is in background-wait with no listed task and an expected follow-up turn
- **THEN** its details say it is waiting for a follow-up turn

#### Scenario: After the session ends

- **WHEN** an execution that was asked and said it was done has ended
- **THEN** its details still show what held it open and that it answered done

#### Scenario: Check-in diagnoses a held session

- **WHEN** a check-in reads a waiting execution with `sessions_get`
- **THEN** the result includes the items holding it open and its last activity

#### Scenario: Many long descriptions

- **WHEN** a check-in reads an execution holding 32 items whose descriptions are full of quotes and multibyte characters
- **THEN** the call succeeds within the size limit, keeps the execution's other facts and says how many items it left out

#### Scenario: Secret in a description

- **WHEN** a background item's description contains the bot's token
- **THEN** the recorded and shown description is redacted
