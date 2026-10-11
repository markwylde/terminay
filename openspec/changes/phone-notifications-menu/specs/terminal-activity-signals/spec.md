## ADDED Requirements

### Requirement: Notifications on a compact workspace

A compact workspace SHALL show a Notifications control on its chrome row, carrying the same count as the header Notifications number on a wide workspace and no count when there are none. Pressing it SHALL open a sheet from the bottom edge, presented as the unified switcher is, that lists the same notifications in the same order as the wide Notifications list, each with its headline, its message where a process sent one, its terminal, its project, and its age. Choosing a notification SHALL go to its terminal, close the sheet, and clear that notification as selecting the terminal does. Each notification SHALL have a dismiss control that removes it without selecting anything, and the sheet SHALL offer Clear all while it lists any. With none, the sheet SHALL say so. The sheet SHALL close on Escape and on a press outside it, and SHALL NOT be shown at the same time as the unified switcher.

#### Scenario: A count on the compact row

- **WHEN** a compact workspace has two notifications
- **THEN** its Notifications control shows the number 2

#### Scenario: Opening the list by touch

- **WHEN** a user presses the Notifications control on a compact workspace
- **THEN** a sheet lists every notification, including one a process sent with its title and message

#### Scenario: Going to a terminal from the sheet

- **WHEN** a user chooses a notification in the sheet
- **THEN** its terminal is shown, the sheet closes, and that notification is cleared

#### Scenario: Clearing everything

- **WHEN** a user chooses Clear all in the sheet
- **THEN** every notification is removed, the sheet says there are none, and the control shows no count

#### Scenario: No notifications

- **WHEN** a user presses the Notifications control and there are no notifications
- **THEN** the sheet says there are none and offers no Clear all
