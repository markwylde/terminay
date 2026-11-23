## MODIFIED Requirements

### Requirement: Bounded concurrent execution admission

The server SHALL admit four work executions and one reserved user-message coordination execution per bot, plus one check-in execution in a slot of its own that no other execution uses, with at most twenty waiting executions. Each trigger SHALL have at most one pending firing. Every admitted execution, including one in the reserved coordination slot, SHALL be able to use the bot's shell and desktop alongside the bot's other live executions, without acquiring ownership of either. When an ordinary work slot frees while an execution occupies the reserved coordination slot, the server SHALL move that execution into the ordinary slot so the reserved slot is available for the next user message. Instructions, pinned memories, agent, model, sign-in and approval mode SHALL be snapshotted per execution. Completed providers SHALL close rather than remaining idle for later messages.

#### Scenario: Coordination while work capacity is full

- **WHEN** four work executions run and a user posts a correction
- **THEN** a reserved coordination execution can inspect, message, stop or replace older work, and can run shell commands of its own

#### Scenario: Check-in while work capacity is full

- **WHEN** four work executions and a reserved-slot execution run, and one of them reaches a 15-minute mark
- **THEN** its check-in runs in the check-in slot

#### Scenario: Stuck check-in does not block a user message

- **WHEN** four work executions run, a check-in is stuck in the check-in slot, and a user posts a correction
- **THEN** the correction is admitted into the reserved coordination slot

#### Scenario: Profile edited during work

- **WHEN** a user edits the bot's instructions during an execution
- **THEN** that execution retains its snapshot and subsequent executions use the revised profile

#### Scenario: Reserved slot is returned

- **WHEN** four work executions and a reserved-slot execution run, and one work execution ends
- **THEN** the reserved-slot execution moves into the freed work slot, and a further user message is admitted into the reserved slot immediately

#### Scenario: Unrelated work overlaps

- **WHEN** a trigger execution is running shell commands and a user posts an unrelated request
- **THEN** the new execution runs its own shell commands while the trigger execution keeps running, and neither is refused for the other's activity

### Requirement: Stopping a turn and closing an agent

**Stop** SHALL ask the agent to cancel the running turn. It SHALL then end the session's process group, so that no command the turn started keeps running: once the agent acknowledges the cancel, or after 10 seconds if it does not, first with a termination signal and then, 5 seconds later, with a kill signal. The turn SHALL be marked stopped, and the agent closed.

Stop SHALL revoke the execution capability, close the execution and retain its diagnostics. The next user message SHALL start a fresh execution.

An agent SHALL be closed whenever its session ends or is suspended, and whenever its bot stops. Closing SHALL first close the agent's input, then end its process group after 5 seconds. An agent SHALL count as closed only once its process group is confirmed gone.

Each session SHALL run under a root supervisor that leads its process group for the whole session. That supervisor SHALL hold a root-only record of the group, the leader's start time, and a random session nonce, and SHALL retire the record once the group is empty. A signal SHALL be sent to a group only while its recorded leader is alive with a matching start time. Otherwise, it SHALL be sent only to processes that are in that group and carry the session's nonce, so that a reused group number never reaches unrelated work. The session view SHALL say that a process the agent moved into its own process group is not ended by Stop, but is ended by stopping the bot.

A turn SHALL have no maximum duration. The server SHALL run no timer that ends a turn, and SHALL launch each agent with its own background-work time limit turned off, so a session runs until its work ends, it fails, or it is stopped.

Each request to the container engine that ends a session's process group, or every process group in a bot container, SHALL be allowed 5 minutes to complete before the server treats that request as failed. The limit applies to each request, so closing an agent and its runtime relays can take longer in total.

An execution's cleanup has failed when ending its agent's process group is not confirmed. A failure to end one of its runtime relays SHALL be logged with its error but SHALL NOT count as a cleanup failure. After a cleanup failure, the server SHALL still revoke the execution's capability and durably record the execution. Except at the blocking threshold below, a cleanup failure SHALL NOT change the outcome the turn already recorded: a turn whose agent answered stays completed, and a stopped, timed-out or failed turn keeps that outcome. The server SHALL durably append the cleanup failure to that execution's runner output and log it with its error to the server diagnostics, both redacted with the bot's secrets.

Cleanup failures SHALL be counted per bot in the order executions finish. A bot SHALL keep admitting executions until 3 consecutive finished executions of that bot have failed cleanup. An execution that finishes with confirmed cleanup SHALL reset that count while the bot is not blocked. On the third consecutive failure, the bot SHALL be blocked: that execution SHALL be marked failed with cause `engine` and a reason saying the bot is blocked after repeated cleanup failures, waiting work SHALL be cancelled, and new executions SHALL be refused. An execution that finishes after the bot is blocked SHALL NOT unblock it. The bot SHALL be unblocked when the server's startup reconciliation confirms it has ended every session process group in the bot's container, or when the retry below confirms every unconfirmed cleanup.

Before admitting a new execution for a blocked bot, the server SHALL retry ending the process group of each execution whose cleanup has been unconfirmed since the bot's last confirmed cleanup. It SHALL NOT end any other running execution. When every retry is confirmed, the bot SHALL be unblocked and the new execution admitted, without a server restart, and each retried execution's runner output SHALL record the confirmation. While a retry fails, the new execution SHALL be refused, and a user message SHALL be refused with a reason naming the unconfirmed cleanup and the container engine, not sign-in. Enabling a blocked bot or saving its profile SHALL NOT fail; the bot stays blocked until a retry or reconciliation confirms cleanup.

Any other failure while finishing an execution SHALL block the bot at once, with the same recovery.

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
- **THEN** the turn stays completed, its capability is revoked, its stored runner output records the redacted cleanup failure, the failure is logged, and the trigger's next firing starts a new execution

#### Scenario: Cleanup failure keeps a stopped or timed-out outcome

- **WHEN** a turn is recorded as stopped or timed out and ending its agent's process group then fails
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

#### Scenario: Turn runs for hours

- **WHEN** a turn is still working after several hours
- **THEN** the server does not time it out and the session stays running

#### Scenario: Background monitor outlasts ten minutes

- **WHEN** a Claude Code bot ends its turn with a background monitor that finishes 40 minutes later
- **THEN** the agent is still running when the monitor finishes, and the monitor wakes it

### Requirement: Permission requests from a bot

Each bot SHALL have an approval mode, **Autonomous** or **Ask me**. The approval mode SHALL govern only the agent's own permission requests. Terminay MCP calls from a bot with Terminay MCP access follow the mcp-permissions contract for bot execution callers, whatever the approval mode.

- **Autonomous.** Terminay SHALL answer each of the agent's permission requests with the most permissive single-use option the agent offers, because the agent's own tools act only inside the bot's container.
- **Ask me.** Each request SHALL wait on the user. The session SHALL show as needing the user, both on the dashboard and in the bot's tab, with the agent's options.

A bot whose agent is Autonomous only SHALL always be Autonomous. Its Profile SHALL show the approval mode as fixed and say why: that agent cannot ask permission inside a container.

The first answer from any device SHALL decide a request. Later answers SHALL receive "already answered". A request SHALL stay open until it is answered or its turn ends. A request still unanswered when its turn ends SHALL be answered with the agent's reject option.

#### Scenario: Agent that cannot ask

- **WHEN** a user edits the Profile of a Codex bot
- **THEN** the approval mode shows Autonomous, fixed, with the reason, and Ask me cannot be chosen

#### Scenario: Autonomous bot runs a command

- **WHEN** an Autonomous bot's agent asks permission to run a shell command
- **THEN** Terminay allows it once and the command runs inside the bot's container

#### Scenario: Ask me

- **WHEN** an Ask me bot's agent asks permission to edit a file
- **THEN** the bot's card shows needs you, and the execution details show the request with the agent's options until a user chooses one

#### Scenario: Two devices answer

- **WHEN** two devices answer the same permission request
- **THEN** the first answer is sent to the agent and the second device is told it was already answered

### Requirement: Sessions

Every user-message execution, every trigger run, every failure investigation and every check-in SHALL be a session of exactly one bot. A session SHALL record:

- its origin: chat, trigger (naming the trigger), Run now (naming the trigger), failure (naming the failures it was started for), or check-in (naming the session it watches and how long that session had run);
- the agent and model it ran with;
- its start time, end time, and duration;
- its state: queued, running, suspended, needs you, completed, stopped, timed out, failed, or interrupted;
- its transcript of user messages, agent replies, tool activity, and plan updates.

The Sessions tab SHALL:

- list a bot's sessions, newest first;
- filter them by origin, including failure and check-in, and by outcome, and search them by text;
- filter them by the trigger that started them, covering both its firings and its Run now sessions;
- show the trigger filter as a removable control naming the trigger, with the name the trigger had when the filter was applied;
- show a selected session's transcript and its runner output;
- for a failure session, show the failures it was started for, each linking to the failed session or trigger;
- offer Stop on a running session;
- offer a return to the shared message log without resuming the selected execution.

The listed sessions SHALL be those that match every active filter. Removing the trigger filter, or choosing the Sessions tab itself, SHALL clear only the trigger filter and keep the origin, outcome and text filters. A request to open a specific session SHALL clear the trigger filter, so the requested session is shown. Applying a trigger filter SHALL select the newest matching session.

The trigger filter SHALL match a session by the trigger id recorded in its origin, so a deleted or renamed trigger still finds its retained sessions. The server SHALL apply the trigger filter only within the requested bot's sessions. A trigger id that no session of that bot records, including another bot's trigger id, SHALL return no sessions.

#### Scenario: Trigger run is a session

- **WHEN** a schedule trigger fires
- **THEN** a session with origin trigger, naming that trigger, appears in the bot's Sessions tab and recent sessions

#### Scenario: Reading an ended execution

- **WHEN** a user opens an ended execution
- **THEN** its diagnostics are shown independently of the shared chat, and sending another message creates a fresh execution

#### Scenario: Failure session

- **WHEN** a trigger run fails and the server starts a failure investigation
- **THEN** a session with origin failure appears, the Failure origin filter shows it, and opening it links to the failed trigger run

#### Scenario: Filtering by trigger

- **WHEN** a bot has sessions from chat, from trigger A firing, from Run now on trigger A, and from trigger B, and the Sessions tab is filtered to trigger A
- **THEN** only the two sessions started by trigger A are listed, newest first, and the newest is selected

#### Scenario: Trigger filter combines with other filters

- **WHEN** the Sessions tab is filtered to trigger A and the origin filter is set to Run now
- **THEN** only trigger A's Run now sessions are listed

#### Scenario: No session matches every filter

- **WHEN** the Sessions tab is filtered to a trigger that has never started a session
- **THEN** the list says no sessions match and still shows the trigger filter control

#### Scenario: Clearing the trigger filter

- **WHEN** a user removes the trigger filter control while the outcome filter is set to Failed
- **THEN** the list shows every failed session of the bot, and the outcome filter stays set

#### Scenario: Choosing the Sessions tab clears the trigger filter

- **WHEN** the Sessions tab is filtered to a trigger and the user chooses the Sessions tab
- **THEN** the trigger filter is removed and the other filters are kept

#### Scenario: Opening a specific session clears the trigger filter

- **WHEN** the Sessions tab is filtered to trigger A and the user opens a session of trigger B from Needs you or the recent sessions
- **THEN** the trigger filter is removed and trigger B's session is selected

#### Scenario: Deleted trigger keeps its history

- **WHEN** the Sessions tab is filtered to a trigger that is then deleted, and its sessions are retained
- **THEN** its sessions stay listed under the filter

#### Scenario: Trigger filter is scoped to the bot

- **WHEN** a client asks for a bot's sessions filtered by the id of another bot's trigger
- **THEN** no sessions are returned
