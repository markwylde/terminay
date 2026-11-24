## ADDED Requirements

### Requirement: Tabs status on a compact workspace matches the wide workspace

On a compact workspace, a Tabs row with an agent, or with a non-idle status, SHALL show its status with the same agent status indicator, and the same accessible label, as a dashboard card on a wide window. Working SHALL be amber and breathing. Waiting and blocked SHALL be red. Done SHALL be green. Idle SHALL be neutral grey. An idle row with no agent and an untracked row SHALL show the panel's kind icon instead.

#### Scenario: A working agent on a phone
- **WHEN** an agent is working and a phone shows the Tabs section
- **THEN** its row shows an amber, breathing status dot in the same colour as its card on a wide window

#### Scenario: A waiting or blocked agent on a phone
- **WHEN** one agent is waiting for approval, another is blocked, and a phone shows the Tabs section
- **THEN** both rows show a red status dot, the blocked row's dot is labelled as blocked, and each detail line is red

#### Scenario: A finished agent on a phone
- **WHEN** an agent has finished and its result is unviewed
- **THEN** its row on a phone shows a green status dot

#### Scenario: Idle and untracked rows on a phone
- **WHEN** a phone shows an idle agent, an idle terminal with no agent, and an untracked terminal
- **THEN** the idle agent shows a grey dot, and the other two rows show their kind icon

### Requirement: Status colours on compact section pages match the wide workspace

Every compact section page SHALL draw status marks, status chips and needs-you detail text in the wide workspace's status colours: amber for running or working, red for needing the user, failed or interrupted, green for completed successfully, and neutral grey for idle. A working mark SHALL breathe unless the user prefers reduced motion. Colours that do not express status SHALL keep the accent colour.

#### Scenario: A running workflow on a phone
- **WHEN** a workflow is running and a phone shows the Workflows section
- **THEN** its row's status mark is amber and breathing

#### Scenario: A failed run on a phone
- **WHEN** an automation's last run failed and a phone shows the Automations section
- **THEN** its status is red

#### Scenario: A working bot on a phone
- **WHEN** a bot is working and a phone shows the Bots section
- **THEN** its avatar dot and its status chip are both amber

#### Scenario: Informational chips keep the accent
- **WHEN** a phone shows a pull request row with an informational chip
- **THEN** that chip keeps the accent colour

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion and a phone shows a working row
- **THEN** its amber mark does not breathe
