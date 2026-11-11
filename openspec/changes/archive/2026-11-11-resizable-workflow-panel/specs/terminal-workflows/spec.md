## ADDED Requirements

### Requirement: Workflow panel width

The expanded workflow panel SHALL offer a resize separator on its left edge; the collapsed rail and the narrow-pane overlay SHALL have none. Dragging the separator SHALL resize the panel as the pointer moves, with the terminal refitting to stay left of it, and releasing SHALL set the chosen width. A cancelled drag SHALL leave the chosen width unchanged. The chosen width SHALL stay between 200 and 640 pixels, and SHALL be 264 pixels until the user resizes it.

#### Scenario: Dragging the panel wider

- **WHEN** the panel is expanded at 264 pixels and the user drags its separator 100 pixels to the left
- **THEN** the panel grows with the pointer, the terminal stays left of the panel throughout, and after release the panel is 364 pixels wide

#### Scenario: A cancelled drag changes nothing

- **WHEN** the user drags the separator and the drag is cancelled before release
- **THEN** the panel and the terminal return to their widths from before the drag, and the chosen width is unchanged

#### Scenario: Width is bounded

- **WHEN** the user drags the separator past the minimum or the maximum width
- **THEN** the panel stops at 200 or 640 pixels

#### Scenario: The drag cannot cost the terminal its minimum

- **WHEN** the user drags the separator toward a width that would leave the terminal narrower than 60 columns
- **THEN** the panel stops at the widest width that keeps the terminal at 60 columns

### Requirement: A resize starts from the drawn width

A drag SHALL start from the width the panel is drawn at in its pane, and a press on the separator that does not move SHALL change nothing.

#### Scenario: Clicking a narrowed panel's separator keeps the chosen width

- **WHEN** the chosen width is 480 pixels, the pane draws the panel narrower, and the user presses and releases the separator without moving
- **THEN** the chosen width stays 480 pixels

### Requirement: Workflow panel width from the keyboard

The resize separator SHALL be reachable with Tab. With it focused, Arrow Left SHALL widen the panel and Arrow Right SHALL narrow it, by 16 pixels each from the width the panel is drawn at, within the same bounds as a drag, and SHALL set the chosen width.

#### Scenario: Resizing with the keyboard

- **WHEN** the user focuses the separator and presses Arrow Left twice
- **THEN** the panel is 32 pixels wider

### Requirement: Panel width is a device-local setting

The workflow panel's chosen width SHALL be a device-local user setting, kept and shared exactly as the panel's collapse setting is, and SHALL NOT be stored on the server or in a template. Each pane SHALL draw the chosen width reduced as its own space requires.

#### Scenario: One chosen width for every terminal

- **WHEN** two terminals in split panes of one window show expanded workflow panels and the user resizes one of them
- **THEN** both panels take the new chosen width, each reduced only as its own pane requires, and other devices are unchanged

#### Scenario: The width survives a relaunch

- **WHEN** the user resizes the panel and relaunches Terminay on that device
- **THEN** the expanded panel opens at the width the user chose

#### Scenario: A stored width that cannot be used

- **WHEN** the device's stored width is unreadable or outside 200 to 640 pixels
- **THEN** the panel opens at 264 pixels

## MODIFIED Requirements

### Requirement: Narrow panes keep the terminal usable

When a pane cannot show the expanded panel at its chosen width beside a terminal at least 60 columns wide, the expanded panel SHALL show at the widest width that keeps the terminal at 60 columns, without changing the setting. When even the panel's minimum width cannot keep the terminal at 60 columns, the panel SHALL show collapsed whatever the setting is. Expanding it there SHALL open the expanded panel as a transient overlay over the right side of the terminal, at the chosen width or 85% of the pane's width if that is less, without resizing the terminal and without changing either setting. While the overlay is open, the collapsed rail SHALL NOT be shown and nothing from it SHALL be drawn over the overlay; when the overlay closes and the pane is still narrow, the rail SHALL show again. The overlay SHALL close when the user presses Escape, activates the collapse control, or moves focus to the terminal, and the terminal SHALL receive no input while the overlay has focus.

#### Scenario: The panel narrows to keep the terminal's columns

- **WHEN** the chosen width is 480 pixels, the setting is expanded, and the pane fits a 60-column terminal beside a 300-pixel panel but not beside a 480-pixel one
- **THEN** the panel shows expanded and narrower than 480 pixels, the terminal keeps at least 60 columns, and the chosen width is unchanged

#### Scenario: The panel regains its chosen width as the pane grows

- **WHEN** a pane has drawn the panel narrower than its chosen width and then becomes wide enough for it
- **THEN** the panel shows at its chosen width

#### Scenario: Expanding in a narrow pane

- **WHEN** the setting is expanded and a terminal's pane is too narrow for the panel's minimum width beside 60 columns
- **THEN** the panel shows collapsed and the terminal keeps its width

#### Scenario: The overlay replaces the rail

- **WHEN** the user expands the workflow in a narrow pane
- **THEN** the overlay shows the expanded workflow, the rail's markers and name are not shown, and the terminal keeps its width

#### Scenario: The overlay fits a narrow split pane

- **WHEN** the chosen width is 480 pixels and the user opens the overlay in a split pane 400 pixels wide
- **THEN** the overlay is 340 pixels wide and the terminal keeps its width

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
