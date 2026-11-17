## ADDED Requirements

### Requirement: Resizable Bots rail

The rail on the right of the Bots section, and the context rail on the right of
a bot tab in Chat mode, SHALL offer a resize separator on its left edge that
looks and behaves like the Pull Requests and Issues preview separator.
Dragging it SHALL resize the rail as the pointer moves, and releasing SHALL set
the chosen width. A drag SHALL start from the width the rail is drawn at; a
cancelled drag, or a press that does not move, SHALL leave the chosen width
unchanged.

#### Scenario: Dragging the rail wider

- **WHEN** the rail is 300 pixels wide and the user drags its separator 100
  pixels to the left
- **THEN** the rail grows with the pointer and after release it is 400 pixels
  wide

#### Scenario: A cancelled drag changes nothing

- **WHEN** the user drags the separator and the drag is cancelled before release
- **THEN** the rail returns to its width from before the drag and the chosen
  width is unchanged

#### Scenario: A press without a move changes nothing

- **WHEN** the user presses and releases the separator without moving
- **THEN** the chosen width is unchanged

### Requirement: Bots rail width from the keyboard

The rail's resize separator SHALL be reachable with Tab. With it focused,
Arrow Left SHALL widen and Arrow Right SHALL narrow the rail by 16 pixels from
the width it is drawn at, within the same bounds as a drag, and SHALL set the
chosen width.

#### Scenario: Resizing with the keyboard

- **WHEN** the user focuses the separator and presses Arrow Left twice, then
  Arrow Right once
- **THEN** the rail is 16 pixels wider than before

### Requirement: Bots rail width bounds

A width the user sets SHALL be between 240 and 560 pixels, and the chosen width
SHALL be 300 pixels until the user sets one. The rail SHALL be drawn at the
chosen width reduced so that the column beside it keeps at least 420 pixels,
and never narrower than 240 pixels; a remembered width outside 240 to 560
pixels SHALL be drawn within them. Drawing narrower SHALL NOT change the chosen
width.

#### Scenario: The width is bounded

- **WHEN** the user drags the separator past 560 pixels, or to less than 240
- **THEN** the rail stops at 560 or 240 pixels

#### Scenario: The main column keeps its room

- **WHEN** the chosen width is 560 pixels and the Bots area is 900 pixels wide
- **THEN** the rail is drawn 480 pixels wide and the column beside it keeps 420
  pixels

#### Scenario: The chosen width returns when there is room

- **WHEN** the chosen width is 560 pixels, the Bots area narrows to 900 pixels,
  and then widens to 1,400 pixels
- **THEN** the rail is drawn 480 pixels wide and then 560 pixels wide, and the
  chosen width stays 560 pixels throughout

#### Scenario: A Bots area too narrow to resize

- **WHEN** a bot tab in Chat mode is 600 pixels wide beside another Home tab in
  a 1,600-pixel window
- **THEN** the context rail is drawn 240 pixels wide and there is no resize
  separator

### Requirement: Bots rail in a narrow window

When the window is 860 pixels wide or narrower, the Bots section's rail SHALL
be stacked under the bot cards at full width, and a bot tab's context rail
SHALL be hidden. Neither SHALL have a resize separator or anything to reach
with Tab for resizing. The chosen width SHALL be unchanged.

#### Scenario: A narrow window on the Bots section

- **WHEN** the window is 800 pixels wide and the user opens the Bots section
- **THEN** the rail is under the bot cards and there is no resize separator

#### Scenario: A narrow window on a bot tab

- **WHEN** the window is 800 pixels wide and the user opens a bot tab in Chat
  mode
- **THEN** the context rail is not shown and there is no resize separator

### Requirement: Bots rail width is remembered on the device

The Bots section and every bot tab SHALL share one chosen rail width,
remembered on the device and never stored on the server.

#### Scenario: One chosen width everywhere

- **WHEN** the user widens the rail in the Bots section to 400 pixels and then
  opens a bot tab in Chat mode whose area has room for it
- **THEN** the bot tab's context rail is drawn 400 pixels wide

#### Scenario: The width survives a relaunch

- **WHEN** the user sets the rail to 400 pixels and relaunches Terminay on that
  device
- **THEN** the chosen width is 400 pixels
