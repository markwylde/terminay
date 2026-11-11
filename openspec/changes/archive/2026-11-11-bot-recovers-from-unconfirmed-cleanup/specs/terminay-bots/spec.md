## MODIFIED Requirements

### Requirement: Stopping a turn and closing an agent

**Stop** SHALL ask the agent to cancel the running turn. It SHALL then end the session's process group, so that no command the turn started keeps running: once the agent acknowledges the cancel, or after 10 seconds if it does not, first with a termination signal and then, 5 seconds later, with a kill signal. The turn SHALL be marked stopped, and the agent closed.

Stop SHALL revoke the execution capability, close the execution and retain its diagnostics. The next user message SHALL start a fresh execution.

An agent SHALL be closed whenever its session ends, is suspended, or times out, and whenever its bot stops. Closing SHALL first close the agent's input, then end its process group after 5 seconds. An agent SHALL count as closed only once its process group is confirmed gone.

When the container engine cannot confirm that an execution's process group is gone, that execution SHALL be marked failed, the engine's error SHALL be kept in its runner output, and the bot SHALL start no further execution until the cleanup is confirmed. Before each new execution the server SHALL retry the unconfirmed cleanup of only those executions, never ending other running executions. Once every retry is confirmed the bot SHALL run normally, without a server restart. While a retry still fails, a user message SHALL be refused with a reason naming the unconfirmed cleanup and the container engine, not sign-in. Enabling the bot or saving its profile SHALL NOT fail because a cleanup is unconfirmed.

Each session SHALL run under a root supervisor that leads its process group for the whole session. That supervisor SHALL hold a root-only record of the group, the leader's start time, and a random session nonce, and SHALL retire the record once the group is empty. A signal SHALL be sent to a group only while its recorded leader is alive with a matching start time. Otherwise, it SHALL be sent only to processes that are in that group and carry the session's nonce, so that a reused group number never reaches unrelated work. The session view SHALL say that a process the agent moved into its own process group is not ended by Stop, but is ended by stopping the bot.

Each turn SHALL have a maximum duration, settable per bot and 30 minutes by default. A turn that exceeds it SHALL be stopped as above, and the session SHALL be marked timed out.

#### Scenario: Agent honours cancel, but its command keeps running

- **WHEN** a user chooses Stop while the agent runs `sleep 300`, and the agent acknowledges the cancel at once
- **THEN** the session's process group is ended, `sleep 300` no longer runs, the turn is marked stopped, and the user's next message starts a fresh execution

#### Scenario: Agent ignores cancel

- **WHEN** a user chooses Stop and the agent is still running after 10 seconds
- **THEN** the session's process group is ended, no process from that group remains, and the turn is marked stopped

#### Scenario: Agent crashes

- **WHEN** the agent process exits during a turn
- **THEN** the session is marked failed, the reason and runner output are kept, and the bot's card shows the failure

#### Scenario: Engine briefly fails to confirm cleanup

- **WHEN** Bird's execution finishes, the engine fails the request that ends its process group, and the engine has recovered by the time the user sends Bird a message
- **THEN** that execution is marked failed with the engine's error in its runner output, its process group is ended again, and the user's message starts a fresh execution without a server restart

#### Scenario: Cleanup still cannot be confirmed

- **WHEN** a user sends Bird a message while the retried cleanup still fails
- **THEN** the message is refused with a reason naming the unconfirmed cleanup and the container engine, and the next message retries the cleanup again
