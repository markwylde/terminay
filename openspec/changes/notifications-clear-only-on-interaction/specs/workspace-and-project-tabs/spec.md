## MODIFIED Requirements

### Requirement: Project activity dot follows viewed terminals

The project-tab activity dot SHALL reflect the same terminals that currently show a visible activity indicator, resolved by the pair of the tab's server and its project. Clicking a terminal tab, clicking into the terminal, typing, moving focus to it with a terminal navigation command, or dismissing its notification SHALL remove that terminal from the dot's state, and nothing else SHALL. Activating the project SHALL NOT remove a terminal from it. A working terminal SHALL keep contributing while it is working, including when its tab is focused. The dot SHALL hide when no terminal contributes.

#### Scenario: Activating the project keeps the dot

- **WHEN** a project shows a green dot because a single terminal has finished unviewed activity, and the user activates that project without clicking the terminal
- **THEN** the project tab dot remains green

#### Scenario: Focusing the last finished terminal

- **WHEN** a project shows a green dot because a single terminal has finished unviewed activity, and the user clicks that terminal tab
- **THEN** the project tab dot hides

#### Scenario: Completion on the focused terminal

- **WHEN** the only activity in a project is structured or agent completion on the terminal the user is already viewing
- **THEN** the project tab dot stays hidden

#### Scenario: Working on the focused terminal

- **WHEN** the focused terminal in a project is working and no other terminal in that project has an indicator
- **THEN** the project tab keeps an amber breathing dot

#### Scenario: Identical project ids on two servers

- **WHEN** two attached servers each hold a project with the same id and only one of them has an unviewed finished terminal
- **THEN** only that server's tab shows the dot
