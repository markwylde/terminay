## ADDED Requirements

### Requirement: Resizable Home detail preview

On Home, the detail preview beside the Pull Requests or Issues list SHALL offer
a resize separator on its left edge. Dragging the separator SHALL resize the
preview as the pointer moves, and releasing SHALL set the chosen width. A drag
SHALL start from the width the preview is drawn at; a cancelled drag, or a
press that does not move, SHALL leave the chosen width unchanged.

#### Scenario: Dragging the preview wider

- **WHEN** the preview is 380 pixels wide and the user drags its separator 100
  pixels to the left
- **THEN** the preview grows with the pointer and after release it is 480
  pixels wide

#### Scenario: A cancelled drag changes nothing

- **WHEN** the user drags the separator and the drag is cancelled before release
- **THEN** the preview returns to its width from before the drag and the chosen
  width is unchanged

#### Scenario: A press without a move changes nothing

- **WHEN** the chosen width is 720 pixels, the preview is drawn narrower, and
  the user presses and releases the separator without moving
- **THEN** the chosen width stays 720 pixels

### Requirement: Home detail preview width from the keyboard

The preview's resize separator SHALL be reachable with Tab. With it focused,
Arrow Left SHALL widen and Arrow Right SHALL narrow the preview by 16 pixels
from the width it is drawn at, within the same bounds as a drag, and SHALL set
the chosen width.

#### Scenario: Resizing with the keyboard

- **WHEN** the user focuses the separator and presses Arrow Left twice, then
  Arrow Right once
- **THEN** the preview is 16 pixels wider than before

### Requirement: Home detail preview width bounds

A width the user sets SHALL be between 280 and 720 pixels, and the chosen width
SHALL be 380 pixels until the user sets one. The preview SHALL be drawn at the
chosen width reduced so that the list keeps at least 320 pixels, and never
narrower than 280 pixels; a remembered width outside 280 to 720 pixels SHALL be
drawn within them. Drawing narrower SHALL NOT change the chosen width.

#### Scenario: The width is bounded

- **WHEN** the user drags the separator past 720 pixels, or to less than 280
- **THEN** the preview stops at 720 or 280 pixels

#### Scenario: The list keeps its room

- **WHEN** the chosen width is 720 pixels and the Home area is 900 pixels wide
- **THEN** the preview is drawn 580 pixels wide and the list keeps 320 pixels

#### Scenario: The chosen width returns when there is room

- **WHEN** the chosen width is 720 pixels, the Home area narrows to 900 pixels,
  and then widens to 1,400 pixels
- **THEN** the preview is drawn 580 pixels wide and then 720 pixels wide

### Requirement: Home detail preview stacks in a narrow area

When the Home area holding the list is narrower than 600 pixels, or the window
is 900 pixels wide or narrower, the preview SHALL be stacked under the list,
with no resize separator and nothing to reach with Tab for resizing.

#### Scenario: A narrow Home tab in a wide window

- **WHEN** a Home tab showing Pull Requests is 560 pixels wide in a 1,600-pixel
  window and the user selects a pull request
- **THEN** the preview is under the list and there is no resize separator

### Requirement: Home detail preview width is remembered on the device

The Pull Requests and Issues sections SHALL share one chosen preview width,
remembered on the device and never stored on the server. Each section SHALL
draw that width within its own bounds.

#### Scenario: One chosen width for both sections

- **WHEN** the user widens the preview in Pull Requests to 480 pixels and then
  selects an issue in Issues, whose area has room for it
- **THEN** the Issues preview is drawn 480 pixels wide

#### Scenario: The width survives a relaunch

- **WHEN** the user sets the preview to 480 pixels and relaunches Terminay on
  that device
- **THEN** the chosen width is 480 pixels
