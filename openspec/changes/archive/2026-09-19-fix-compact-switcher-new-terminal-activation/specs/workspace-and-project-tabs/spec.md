## ADDED Requirements

### Requirement: Compact switcher terminal creation shows the created terminal

A terminal created from the compact switcher SHALL become the active terminal of its project: it SHALL be the terminal shown on screen, it SHALL receive terminal focus, and the switcher SHALL mark it as current the next time it opens. This SHALL hold for **New terminal**, which creates in the project in front, and for a project group's new-terminal control, which SHALL select that group's project on its own server first when it is not the project in front. The switcher SHALL dismiss when either create action is pressed. The terminal on screen and the switcher's current row SHALL never name different terminals after a create.

#### Scenario: New terminal in the project in front
- **WHEN** a user opens the compact switcher and presses New terminal
- **THEN** the switcher dismisses, a terminal is created in the project in front, and that terminal replaces the previous one on screen and takes terminal focus

#### Scenario: New terminal in a background project
- **WHEN** a user presses the new-terminal control of a project group that is not the project in front
- **THEN** that project becomes active on its own server and the created terminal is the terminal shown on screen

#### Scenario: Switcher agrees with the screen
- **WHEN** a user reopens the compact switcher after creating a terminal from it
- **THEN** the row marked current is the created terminal, which is also the terminal on screen
