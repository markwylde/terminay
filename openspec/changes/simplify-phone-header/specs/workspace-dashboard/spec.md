## MODIFIED Requirements

### Requirement: Home control presentation

The Home control SHALL be an icon-only control on the project bar, and the Home item of the compact switcher's rail, showing a house glyph and distinguished from project tabs so that it never reads as a project. It SHALL show a selected state while Home is the selected view, SHALL be reachable by keyboard, and SHALL carry an accessible name naming Home. While Home is selected, the chrome band SHALL use a neutral Home colour rather than any project's colour. On the project bar, the selected Home control SHALL be drawn as a tab that opens into Home's tab strip in that colour, as the active project tab opens into its project's tab strip.

#### Scenario: Selected state

- **WHEN** Home is the selected view
- **THEN** the Home control shows its selected state, no project tab shows an active state, and the chrome band uses the neutral Home colour

#### Scenario: Selected Home control opens into the band

- **WHEN** Home is selected on the project bar
- **THEN** the Home control is drawn as a tab joined to Home's tab strip, both in the neutral Home colour

#### Scenario: House glyph

- **WHEN** the project bar or the compact switcher's rail renders the Home control
- **THEN** the control shows a house glyph

#### Scenario: Accessible name

- **WHEN** assistive technology reads the Home control
- **THEN** it announces a name identifying Home

### Requirement: Unread bot posts are counted on the Home control

The Home control on the project bar SHALL show the window's unread bot post count: the sum of the post counts of the bot notifications the window's server has published to it, over the bots that window knows. It SHALL show no count when that sum is zero. The count SHALL update live, SHALL read `99+` above 99, and SHALL be part of the control's accessible name, stated exactly.

#### Scenario: Seen from a project

- **WHEN** a project is the selected view and the server has published a notification for the bot Bird with three posts
- **THEN** the Home control shows 3 without the user opening Home, and its accessible name says three unread messages

#### Scenario: Summed over bots

- **WHEN** published notifications hold three posts for Bird and one for Owl
- **THEN** the Home control shows 4

#### Scenario: More than 99

- **WHEN** published notifications hold 120 posts in total
- **THEN** the Home control shows `99+` and its accessible name says 120 unread messages

#### Scenario: Not yet published

- **WHEN** a bot posts and the notification settle period has not yet passed
- **THEN** the Home control does not count the post

#### Scenario: Nothing unread

- **WHEN** the server has published no bot notification
- **THEN** the Home control shows no count and its accessible name is Home
