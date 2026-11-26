## ADDED Requirements

### Requirement: Session transcript entries record when they happened

The server SHALL record, with every update it stores in a session transcript, the time it admitted that update to the transcript, from the server clock. This SHALL cover the agent's updates and the server's own records: the user's prompt, permission requests, and the truncation marker. A time supplied in an update's content SHALL never replace or stand in for the recorded time.

Each transcript entry SHALL take the recorded time of the update that starts it:

- a user prompt, a permission request, and the truncation marker: their record;
- an agent message or a thought: its first chunk;
- a tool call: its first update;
- the plan: its first update.

A recorded time that is not a valid date SHALL be treated as no time. Transcript text search SHALL NOT match recorded times.

#### Scenario: A message streamed over time keeps its start time

- **WHEN** an agent message arrives in chunks from 10:00:58 to 10:01:30
- **THEN** the message's time is that of its first chunk

#### Scenario: A tool call keeps its start time

- **WHEN** a tool call's first update arrives at 09:15:02 and its completion at 09:17:40
- **THEN** the tool call's time is 09:15:02

#### Scenario: The agent cannot set an entry's time

- **WHEN** an agent update carries its own value in the field the server uses for the recorded time
- **THEN** the stored update carries the server's recorded time instead

#### Scenario: Times survive a restart

- **WHEN** the server restarts and a user reopens a session recorded before the restart
- **THEN** each entry shows the time recorded when it first arrived

#### Scenario: Search ignores recorded times

- **WHEN** a user searches sessions for a number that appears only in recorded times
- **THEN** no session matches because of its recorded times

### Requirement: Session transcript shows entry times

The Sessions tab SHALL show a time on each transcript entry it displays: the user prompt, each agent message, each thought, each tool call, each group of tool calls, the plan, and the truncation notice. A group SHALL show the time of its first tool call, and each tool call inside an expanded group SHALL show its own time. Permission requests are not displayed as entries and show no time.

Each time SHALL be small and secondary to its entry and SHALL use the chat message time format. Hovering it SHALL show the full date and time, with seconds. An entry with no recorded time SHALL show none. Runner output SHALL show no per-entry times.

#### Scenario: Prompt, reply and tool call show their times

- **WHEN** a user opens a session whose prompt was recorded at 14:02:05, whose agent replied at 14:02:09, and which ran a Bash tool call at 14:02:11
- **THEN** the prompt shows 14:02, the reply shows 14:02, and the Bash tool call shows 14:02

#### Scenario: Each message and thought in a turn shows its own time

- **WHEN** one agent turn holds a thought at 11:00, a message at 11:01, a tool call, and a second message at 11:06
- **THEN** the thought shows 11:00, the first message 11:01, and the second message 11:06

#### Scenario: Hovering a time shows the full date and time

- **WHEN** the user hovers the time on a tool call
- **THEN** the full date and time of the tool call's first update, including seconds, is shown

#### Scenario: A group of tool calls shows its first call's time

- **WHEN** an agent turn ran three tool calls in a row, the first at 09:15 and the last at 09:18
- **THEN** the "Used 3 tools" line shows 09:15, and expanding it shows each tool call with its own time

#### Scenario: An older day shows its date

- **WHEN** a session entry was recorded on an earlier day more than a week ago
- **THEN** its time shows the date with the clock time

#### Scenario: Entries without a recorded time

- **WHEN** a session's stored updates carry no recorded time, or an invalid one
- **THEN** those entries show no time and the transcript otherwise renders normally

#### Scenario: Chat keeps message-log times

- **WHEN** the same bot's Chat shows its messages
- **THEN** each message shows its message-log posting time, unchanged by recorded transcript times
