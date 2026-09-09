## ADDED Requirements

### Requirement: Project activity count follows viewed terminals

The project-tab activity count SHALL count the same terminals that currently show a visible activity indicator. Clicking a terminal tab, clicking into the terminal, or typing, or already interacting with it when finished or attention activity arrives, SHALL remove that terminal from the count. Activating the project SHALL NOT remove a terminal from the count. A working terminal SHALL remain in the count while it is working, including when its tab is focused. The count SHALL hide when it reaches zero.

#### Scenario: Activating the project keeps the count

- **WHEN** a project shows a green activity count of one because a single terminal has finished unviewed activity, and the user activates that project without clicking the terminal
- **THEN** the project-tab activity count remains `1` and green

#### Scenario: Focusing the last finished terminal

- **WHEN** a project shows a green activity count of one because a single terminal has finished unviewed activity, and the user clicks that terminal tab
- **THEN** the project-tab activity count hides

#### Scenario: Completion on the focused terminal

- **WHEN** the only activity in a project is structured or agent completion on the terminal the user is already viewing
- **THEN** the project-tab activity count stays hidden

#### Scenario: Working on the focused terminal

- **WHEN** the focused terminal in a project is working and no other terminal in that project has an indicator
- **THEN** the project tab keeps an amber activity count of one
