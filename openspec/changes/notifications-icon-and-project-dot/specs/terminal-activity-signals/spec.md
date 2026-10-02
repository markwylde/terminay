## MODIFIED Requirements

### Requirement: Fallback acknowledgement

For terminal fallback activity, clicking the terminal tab, clicking into the terminal, typing into it, or dismissing its notification from the header Notifications list SHALL clear pending finished and attention indicators. Activating the project, including clicking its tab or activity dot, SHALL NOT acknowledge that project's terminals. Selecting a terminal tab and dismissing a terminal's notification SHALL each report the same server-owned acknowledgement as typing; a panel becoming Dockview-active because its project was activated SHALL NOT. Late fallback lifecycle output produced while switching projects SHALL be part of the same viewing acknowledgement for the terminal the user was interacting with at handoff. A terminal counts as the one the user is interacting with only while it is both the terminal they last clicked or typed in and the focused terminal; once focus moves to another terminal, including a newly created one, it no longer does. Structured completion or attention that arrives while the user is already interacting with that terminal SHALL be acknowledged as viewed and SHALL NOT leave a finished or attention indicator on that tab, the project activity dot, or the header Notifications number.

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

- **WHEN** structured completion arrives for the terminal the user is already clicking or typing in
- **THEN** no finished indicator appears on that tab, the project activity dot, or the header Notifications number

#### Scenario: Attention on an already interacting terminal

- **WHEN** a bell or notification arrives for the terminal the user is already clicking or typing in
- **THEN** no attention indicator appears on that tab, the project activity dot, or the header Notifications number

#### Scenario: Completion after moving to another terminal

- **WHEN** a user types in one terminal, then opens or focuses another terminal, and structured or agent completion then arrives for the first
- **THEN** the first terminal shows a finished indicator, and its project activity dot and the header Notifications number include it

#### Scenario: Project switch handoff

- **WHEN** late fallback lifecycle output is produced while switching projects
- **THEN** it belongs to the same viewing acknowledgement for the terminal that was visible at handoff
