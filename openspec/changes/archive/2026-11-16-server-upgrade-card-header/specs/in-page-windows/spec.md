## ADDED Requirements

### Requirement: A window title fits its title bar

An in-page window's title SHALL stay on one line in its title bar. A title wider
than the space beside the window's controls SHALL be cut with an ellipsis and
SHALL offer its full text as a tooltip. The window's accessible name SHALL remain
the full title.

#### Scenario: A long title

- **WHEN** an in-page window opens with a title wider than its title bar
- **THEN** the title is shown on one line ending in an ellipsis, hovering it shows the full title, and the window's accessible name is the full title

#### Scenario: A short title

- **WHEN** an in-page window opens with a title that fits its title bar
- **THEN** the title is shown in full on one line
