## MODIFIED Requirements

### Requirement: Narrow panes keep the terminal usable

When a pane is too narrow to show the expanded panel beside a terminal at least 60 columns wide, the panel SHALL show collapsed whatever the setting is. Expanding it there SHALL open the expanded panel as a transient overlay over the right side of the terminal, without resizing the terminal and without changing the setting. While the overlay is open, the collapsed rail SHALL NOT be shown and nothing from it SHALL be drawn over the overlay; when the overlay closes and the pane is still narrow, the rail SHALL show again. The overlay SHALL close when the user presses Escape, activates the collapse control, or moves focus to the terminal, and the terminal SHALL receive no input while the overlay has focus.

#### Scenario: Expanding in a narrow pane

- **WHEN** the setting is expanded and a terminal's pane is too narrow
- **THEN** the panel shows collapsed and the terminal keeps its width

#### Scenario: The overlay replaces the rail

- **WHEN** the user expands the workflow in a narrow pane
- **THEN** the overlay shows the expanded workflow, the rail's markers and name are not shown, and the terminal keeps its width

#### Scenario: Closing the overlay

- **WHEN** the user opens the overlay in a narrow pane and presses Escape
- **THEN** the overlay closes, the rail shows again, the terminal is uncovered and focused, and the setting is unchanged

#### Scenario: Closing the overlay with its collapse control

- **WHEN** the user opens the overlay in a narrow pane and activates its collapse control
- **THEN** the overlay closes, the rail shows again, the terminal is focused and keeps its width, and the setting is unchanged

#### Scenario: Closing the overlay by focusing the terminal

- **WHEN** the user opens the overlay in a narrow pane and moves focus to the terminal
- **THEN** the overlay closes, the rail shows again, the terminal keeps its width, and the setting is unchanged

#### Scenario: The pane widens while the overlay is open

- **WHEN** the overlay is open, the setting is expanded, and the pane becomes wide enough for the expanded panel
- **THEN** the overlay closes and the panel shows expanded beside the terminal, with no rail
