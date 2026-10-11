## MODIFIED Requirements

### Requirement: Fallback acknowledgement

For terminal fallback activity, clicking the terminal tab, clicking into the terminal, typing into it, moving focus to it with a terminal navigation command, or dismissing its notification from the header Notifications list SHALL clear pending finished and attention indicators. Activating the project, including clicking its tab or activity dot, SHALL NOT acknowledge that project's terminals. Selecting a terminal tab and dismissing a terminal's notification SHALL each report the same server-owned acknowledgement as typing; a panel becoming Dockview-active because its project was activated SHALL NOT. Late fallback lifecycle output produced while switching projects SHALL be part of the same viewing acknowledgement for the terminal the user was interacting with at handoff. Nothing else SHALL clear them. Where the user is when completion or attention arrives SHALL NOT acknowledge it: activity for the focused terminal, including one the user has just typed in, SHALL show its indicator and SHALL count until the user does one of those things in that terminal. Focus that reaches a terminal without the user acting on that terminal, as when the window returns to the front or its project is activated, SHALL NOT acknowledge it. Moving the mouse over a terminal SHALL NOT acknowledge it.

#### Scenario: Viewing clears the indicator

- **WHEN** a user clicks a terminal tab, clicks into the terminal, or types into a terminal with a pending fallback indicator
- **THEN** the indicator clears

#### Scenario: Tab selection acknowledgement

- **WHEN** a user clicks a terminal tab
- **THEN** it reports the same server-owned acknowledgement as typing into that terminal

#### Scenario: Dismissal acknowledgement

- **WHEN** a user dismisses a terminal's notification from the header Notifications list
- **THEN** it reports the same server-owned acknowledgement as typing into that terminal, and the terminal is not selected

#### Scenario: Activating a project does not acknowledge

- **WHEN** a background project has a terminal with a finished or attention indicator and the user activates that project without clicking the terminal tab, clicking into the terminal, or typing
- **THEN** the terminal indicator, project activity dot, and header Notifications number remain

#### Scenario: Focusing a finished tab

- **WHEN** a user clicks a terminal tab that shows a finished unviewed indicator
- **THEN** the terminal indicator and that terminal's contribution to its project's activity dot and to the header Notifications number all clear

#### Scenario: Focusing an attention tab

- **WHEN** a user clicks a terminal tab that shows a fallback attention indicator
- **THEN** the terminal indicator and that terminal's contribution to its project's activity dot and to the header Notifications number all clear

#### Scenario: Completion on an already interacting terminal

- **WHEN** structured or agent completion arrives for the focused terminal the user last typed in, and the user does nothing further in it
- **THEN** a finished indicator appears on that tab and the project activity dot, and the header Notifications number includes it once it is published

#### Scenario: Attention on an already interacting terminal

- **WHEN** a bell or notification arrives for the focused terminal the user last typed in, and the user does nothing further in it
- **THEN** an attention indicator appears on that tab and the project activity dot, and the header Notifications number includes it once it is published

#### Scenario: Moving the mouse over the terminal

- **WHEN** a terminal shows a finished or attention indicator and the user moves the mouse over that terminal without clicking
- **THEN** the indicator, the project activity dot, and the header Notifications number remain

#### Scenario: Returning to the window

- **WHEN** a finished or attention indicator arose while the user was in another application and the user returns to the Terminay window, so that focus lands in that terminal, without clicking or typing in it
- **THEN** the indicator, the project activity dot, and the header Notifications number remain

#### Scenario: Completion after moving to another terminal

- **WHEN** a user types in one terminal, then opens or focuses another terminal, and structured or agent completion then arrives for the first
- **THEN** the first terminal shows a finished indicator, and its project activity dot and the header Notifications number include it

#### Scenario: Project switch handoff

- **WHEN** late fallback lifecycle output is produced while switching projects
- **THEN** it belongs to the same viewing acknowledgement for the terminal that was visible at handoff
