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

#### Scenario: Agent honours cancel, but its command keeps running

- **WHEN** a user chooses Stop while the agent runs `sleep 300`, and the agent acknowledges the cancel at once
- **THEN** the session's process group is ended, `sleep 300` no longer runs, the turn is marked stopped, and the user's next message starts a fresh execution

#### Scenario: Agent ignores cancel

- **WHEN** a user chooses Stop and the agent is still running after 10 seconds
- **THEN** the session's process group is ended, no process from that group remains, and the turn is marked stopped

#### Scenario: Agent crashes

- **WHEN** the agent process exits during a turn
- **THEN** the session is marked failed, the reason and runner output are kept, and the bot's card shows the failure


Desktop-owned graphical applications SHALL remain outside execution process groups and SHALL survive execution closure and Stop. Stopping the bot container SHALL end them. The session view SHALL explain this lifetime distinction.

#### Scenario: Stop preserves the desktop application
- **WHEN** a user stops an execution with a desktop-owned Gridcraft workbook and a session-owned `sleep 300` command
- **THEN** the command ends, Gridcraft stays open with its workbook, and the session view explains that stopping the bot container ends desktop apps
