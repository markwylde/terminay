## MODIFIED Requirements

### Requirement: Fallback activity display language

Terminal fallback activity SHALL use the existing tab-activity language: amber or yellow for working or recent activity, green for finished unviewed activity, red for fallback attention, and no indicator after acknowledgement. Working indicators SHALL remain while the terminal is working, including on the focused tab. Finished and attention indicators SHALL be unviewed signals and SHALL NOT remain once the terminal is viewed. Canonical agent RAG indicators SHALL use the same broad colour vocabulary but SHALL remain a different model, in which an agent's operational state and its acknowledgement flag are orthogonal and viewing an agent acknowledges it without changing `working`, `waiting`, `blocked`, `done`, or `idle`.

#### Scenario: Working fallback activity

- **WHEN** a terminal has fallback working or recent activity
- **THEN** its tab shows the amber or yellow indicator

#### Scenario: Working on the focused tab

- **WHEN** the focused terminal is working
- **THEN** its tab keeps the amber or yellow indicator

#### Scenario: Viewing an agent

- **WHEN** a user views a terminal with a canonical agent entry
- **THEN** the agent is acknowledged and its operational state is unchanged

### Requirement: Fallback acknowledgement

For terminal fallback activity, viewing the terminal or typing into it SHALL clear pending finished and attention indicators. Selecting a terminal through the Dockview tab lifecycle SHALL report the same server-owned acknowledgement as programmatic focus; focus styling alone SHALL NOT leave fallback shell noise counted as unviewed. Late fallback lifecycle output produced while switching projects SHALL be part of the same viewing acknowledgement for the terminal that was visible at handoff. Structured completion or attention that arrives while the terminal is already focused SHALL be acknowledged as viewed and SHALL NOT leave a finished or attention indicator on that tab, the project activity count, or the header aggregate.

#### Scenario: Viewing clears the indicator

- **WHEN** a user views or types into a terminal with a pending fallback indicator
- **THEN** the indicator clears

#### Scenario: Tab selection acknowledgement

- **WHEN** a terminal is selected through the Dockview tab lifecycle
- **THEN** it reports the same server-owned acknowledgement as programmatic focus

#### Scenario: Focusing a finished tab

- **WHEN** a user focuses a terminal whose tab shows a finished unviewed indicator
- **THEN** the terminal indicator, that project's activity count for this terminal, and the header finished count all clear

#### Scenario: Focusing an attention tab

- **WHEN** a user focuses a terminal whose tab shows a fallback attention indicator
- **THEN** the terminal indicator, that project's activity count for this terminal, and the header attention count all clear

#### Scenario: Completion on an already focused terminal

- **WHEN** structured completion arrives for the terminal the user is already viewing
- **THEN** no finished indicator appears on that tab, the project activity count, or the header aggregate

#### Scenario: Attention on an already focused terminal

- **WHEN** a bell or notification arrives for the terminal the user is already viewing
- **THEN** no attention indicator appears on that tab, the project activity count, or the header aggregate

#### Scenario: Project switch handoff

- **WHEN** late fallback lifecycle output is produced while switching projects
- **THEN** it belongs to the same viewing acknowledgement for the terminal that was visible at handoff
