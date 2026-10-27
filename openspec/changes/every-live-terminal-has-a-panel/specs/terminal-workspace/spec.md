## ADDED Requirements

### Requirement: A running terminal always has a panel

Terminay Server SHALL keep every running terminal shown by a terminal panel in its project. A running terminal that has had no panel for 5 seconds SHALL be given a new terminal panel in its project's General folder, wherever General sits in the folder order, titled with that project's next default terminal title. A terminal that gets a panel, exits, or is ended within those 5 seconds SHALL NOT be given another. A running terminal whose project no longer exists SHALL be ended. The server SHALL check after every committed workspace change and once when it starts, and SHALL NOT poll to do so.

#### Scenario: A closed tab whose shell keeps running

- **WHEN** a user closes a terminal tab and its shell is still running 5 seconds later
- **THEN** the terminal appears again as a tab in its project's General folder
- **AND** closing the project warns only about terminals that are shown

#### Scenario: A closed tab whose shell is ended

- **WHEN** a user closes a terminal tab and the server ends its shell
- **THEN** the terminal is no longer running
- **AND** it does not appear again as a tab

#### Scenario: A terminal started without a panel

- **WHEN** a terminal is running in a project and no panel shows it for 5 seconds
- **THEN** it is given a panel in that project's General folder, titled with the project's next default terminal title, even when General is not the first folder

#### Scenario: A terminal whose creator places it

- **WHEN** a terminal's creator commits its panel within 5 seconds of starting it
- **THEN** the terminal has exactly that one panel

#### Scenario: A terminal that ends while panel-less

- **WHEN** a terminal without a panel exits within 5 seconds
- **THEN** no panel is created for it

#### Scenario: A terminal whose project is gone

- **WHEN** a terminal is still running after its project was closed
- **THEN** the server ends it and creates no panel for it
