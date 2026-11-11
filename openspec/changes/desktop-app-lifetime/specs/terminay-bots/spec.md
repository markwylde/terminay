## ADDED Requirements

### Requirement: Bot instructions describe desktop application launch

Bot instructions SHALL direct agents to the desktop-owned application launcher for graphical applications and the browser helper for websites. They SHALL require a fresh screenshot to verify visible results, distinguish launch acceptance from success, and explain that desktop applications outlive individual executions.

#### Scenario: Agent opens a graphical application
- **WHEN** an execution receives its bot instructions
- **THEN** they describe the supported desktop launch command, diagnostic location, screenshot verification, and desktop application lifetime

## MODIFIED Requirements

### Requirement: Stopping a turn and closing an agent

**Stop** SHALL ask the agent to cancel the running turn. It SHALL then end the session's process group, so that no session-owned command the turn started keeps running: once the agent acknowledges the cancel, or after 10 seconds if it does not, first with a termination signal and then, 5 seconds later, with a kill signal. The turn SHALL be marked stopped, and the agent closed.

Stop SHALL revoke the execution capability, close the execution and retain its diagnostics. The next user message SHALL start a fresh execution.

An agent SHALL be closed whenever its session ends, is suspended, or times out, and whenever its bot stops. Closing SHALL first close the agent's input, then end its process group after 5 seconds. An agent SHALL count as closed only once its process group is confirmed gone.

Each session SHALL run under a root supervisor that leads its process group for the whole session. That supervisor SHALL hold a root-only record of the group, the leader's start time, and a random session nonce, and SHALL retire the record once the group is empty. A signal SHALL be sent to a group only while its recorded leader is alive with a matching start time. Otherwise, it SHALL be sent only to processes that are in that group and carry the session's nonce, so that a reused group number never reaches unrelated work. The session view SHALL say that a process the agent moved into its own process group is not ended by Stop, but is ended by stopping the bot.

Each turn SHALL have a maximum duration, settable per bot and 30 minutes by default. A turn that exceeds it SHALL be stopped as above, and the session SHALL be marked timed out.

Each request to the container engine that ends a session's process group, or every process group in a bot container, SHALL be allowed 5 minutes to complete before the server treats that request as failed. The limit applies to each request, so closing an agent and its runtime relays can take longer in total.

An execution's cleanup has failed when ending its agent's process group is not confirmed. A failure to end one of its runtime relays SHALL be logged with its error but SHALL NOT count as a cleanup failure. After a cleanup failure, the server SHALL still revoke the execution's capability, release any shared shell or desktop ownership it held, and durably record the execution. Except at the blocking threshold below, a cleanup failure SHALL NOT change the outcome the turn already recorded: a turn whose agent answered stays completed, and a stopped, timed-out or failed turn keeps that outcome. The server SHALL durably append the cleanup failure to that execution's runner output and log it with its error to the server diagnostics, both redacted with the bot's secrets.

Cleanup failures SHALL be counted per bot in the order executions finish. A bot SHALL keep admitting executions until 3 consecutive finished executions of that bot have failed cleanup. An execution that finishes with confirmed cleanup SHALL reset that count while the bot is not blocked. On the third consecutive failure, the bot SHALL be blocked: that execution SHALL be marked failed with cause `engine` and a reason saying the bot is blocked after repeated cleanup failures, waiting work SHALL be cancelled, and new executions SHALL be refused. An execution that finishes after the bot is blocked SHALL NOT unblock it. The bot SHALL be unblocked when the server's startup reconciliation confirms it has ended every session process group in the bot's container, or when the retry below confirms every unconfirmed cleanup.

Before admitting a new execution for a blocked bot, the server SHALL retry ending the process group of each execution whose cleanup has been unconfirmed since the bot's last confirmed cleanup. It SHALL NOT end any other running execution. When every retry is confirmed, the bot SHALL be unblocked and the new execution admitted, without a server restart, and each retried execution's runner output SHALL record the confirmation. While a retry fails, the new execution SHALL be refused, and a user message SHALL be refused with a reason naming the unconfirmed cleanup and the container engine, not sign-in. Enabling a blocked bot or saving its profile SHALL NOT fail; the bot stays blocked until a retry or reconciliation confirms cleanup.

Any other failure while finishing an execution SHALL block the bot at once, with the same recovery.

Desktop-owned graphical applications SHALL remain outside execution process groups and SHALL survive execution closure and Stop. Stopping the bot container SHALL end them. The session view SHALL explain this lifetime distinction.

#### Scenario: Agent honours cancel, but its command keeps running

- **WHEN** a user chooses Stop while the agent runs `sleep 300`, and the agent acknowledges the cancel at once
- **THEN** the session's process group is ended, `sleep 300` no longer runs, the turn is marked stopped, and the user's next message starts a fresh execution

#### Scenario: Agent ignores cancel

- **WHEN** a user chooses Stop and the agent is still running after 10 seconds
- **THEN** the session's process group is ended, no process from that group remains, and the turn is marked stopped

#### Scenario: Agent crashes

- **WHEN** the agent process exits during a turn
- **THEN** the session is marked failed, the reason and runner output are kept, and the bot's card shows the failure

#### Scenario: Slow engine finishes cleanup within the deadline

- **WHEN** a turn completes and the container engine takes 45 seconds to run the request that ends its process group
- **THEN** the cleanup succeeds, the turn stays completed, and the bot's next trigger firing runs

#### Scenario: One cleanup failure after a completed turn

- **WHEN** a trigger turn's agent answers and ending its agent's process group then fails
- **THEN** the turn stays completed, its shared-work ownership is released, its stored runner output records the redacted cleanup failure, the failure is logged, and the trigger's next firing starts a new execution

#### Scenario: Cleanup failure keeps a stopped or timed-out outcome

- **WHEN** a user stops a turn, or a turn times out, and ending its agent's process group then fails
- **THEN** the turn stays stopped or timed out, and the cleanup failure is counted and recorded

#### Scenario: Relay cleanup failure

- **WHEN** a turn completes, its agent's process group is confirmed ended, and ending one of its runtime relays fails
- **THEN** the relay failure is logged, the turn stays completed, and the consecutive cleanup-failure count resets

#### Scenario: Successful cleanup resets the count

- **WHEN** two consecutive executions fail cleanup and the next execution to finish has confirmed cleanup
- **THEN** the bot is not blocked, and two further cleanup failures still do not block it

#### Scenario: Concurrent executions finish out of order

- **WHEN** executions A, B and C of one bot start in that order, B and C fail cleanup, and A then finishes with confirmed cleanup
- **THEN** the count is reset when A finishes, and the bot is not blocked

#### Scenario: Third consecutive cleanup failure blocks the bot

- **WHEN** three consecutive finished executions of a bot fail cleanup
- **THEN** the third execution is marked failed with cause `engine` and a reason saying the bot is blocked after repeated cleanup failures, no failure investigation is started for it, its waiting work is cancelled, and new messages and trigger firings are refused while the retried cleanup still fails

#### Scenario: A success after blocking does not unblock

- **WHEN** a bot is blocked by its third consecutive cleanup failure and another execution that was already running then finishes with confirmed cleanup
- **THEN** the bot stays blocked

#### Scenario: Reconciliation unblocks only after confirmed cleanup

- **WHEN** the server starts with a blocked bot and ending every session process group in its container fails
- **THEN** the bot stays blocked, and when a later reconciliation confirms those groups are gone, the bot admits new executions

#### Scenario: Blocked bot recovers on the next message

- **WHEN** a bot is blocked by three consecutive cleanup failures, the engine has recovered, and the user sends it a message
- **THEN** the server ends each of those three executions' process groups again, records the confirmation in their runner output, unblocks the bot, and runs the message without a server restart

#### Scenario: Retried cleanup still fails

- **WHEN** a blocked bot is sent a message and ending an unconfirmed execution's process group fails again
- **THEN** the message is refused with a reason naming the unconfirmed cleanup and the container engine, not sign-in, and the next message retries the cleanup again

#### Scenario: Re-enabling a blocked bot

- **WHEN** a user disables and re-enables a blocked bot
- **THEN** neither action fails, and the bot's next execution retries the unconfirmed cleanup before it runs

#### Scenario: Stop preserves the desktop application

- **WHEN** a user stops an execution with a desktop-owned Gridcraft workbook and a session-owned `sleep 300` command
- **THEN** the command ends, Gridcraft stays open with its workbook, and the session view explains that stopping the bot container ends desktop apps
