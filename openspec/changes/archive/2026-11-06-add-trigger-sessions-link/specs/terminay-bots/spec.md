## MODIFIED Requirements

### Requirement: Sessions

Every user-message execution and every trigger run SHALL be a session of exactly one bot. A session SHALL record:

- its origin: chat, trigger (naming the trigger), or Run now (naming the trigger);
- the agent and model it ran with;
- its start time, end time, and duration;
- its state: queued, running, suspended, needs you, completed, stopped, timed out, failed, or interrupted;
- its transcript of user messages, agent replies, tool activity, and plan updates.

The Sessions tab SHALL:

- list a bot's sessions, newest first;
- filter them by origin and by outcome, and search them by text;
- filter them by the trigger that started them, covering both its firings and its Run now sessions;
- show the trigger filter as a removable control naming the trigger, with the name the trigger had when the filter was applied;
- show a selected session's transcript and its runner output;
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
