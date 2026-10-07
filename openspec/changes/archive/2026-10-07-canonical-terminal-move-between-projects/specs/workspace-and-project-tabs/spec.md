## ADDED Requirements

### Requirement: Moving a terminal to another project is committed by the server

Moving a terminal tab to another project, from **Move to project** or by dropping the tab on a project tab, SHALL be committed through the `panel.move` workspace command. The terminal SHALL be presented in the target project only once the server has committed the move, and from then on SHALL be presented in the target project and in no other project. The moved terminal SHALL keep its session id, scrollback, title, colour, emoji, note, and recording state, and its process SHALL keep running throughout. On the client that requested the move, the target project SHALL become active and the moved terminal SHALL be focused.

A move the server refuses or that fails SHALL leave the terminal presented in its original project, attached and running, and SHALL report the reason.

#### Scenario: Terminal moved from the context menu

- **WHEN** a user chooses **Move to project** and a project for a terminal tab
- **THEN** the move commits through `panel.move`, the target project becomes active, and the terminal is focused there with the same session id and scrollback

#### Scenario: Workspace changes after a move

- **WHEN** a terminal has been moved to another project and the workspace then changes in any way, such as a terminal being created
- **THEN** the moved terminal is presented in its new project only, and its tab does not reappear in the project it left

#### Scenario: Output continues after a move

- **WHEN** a terminal running a long-lived command is moved to another project and projects are switched back and forth
- **THEN** the terminal keeps printing that command's output in its new project and shows no connection error

#### Scenario: Moving a terminal back

- **WHEN** a terminal that was moved to another project is moved back to the project it came from
- **THEN** it is presented once, in the project it came from, and keeps running

#### Scenario: Restart or another client after a move

- **WHEN** a terminal has been moved to another project and the workspace is then opened after a restart or from another client
- **THEN** the terminal is presented in the project it was moved to

#### Scenario: Move refused

- **WHEN** the server refuses a terminal move or the move fails
- **THEN** the terminal stays in its original project, attached and running, and the reason is shown
