## MODIFIED Requirements

### Requirement: Explorer entry actions and project root selection

Users SHALL be able to open files and folders, drag them to the tab area,
create, rename, and delete entries, copy paths, and set a project root from a
terminal working directory. The set-root shortcut SHALL validate the working
directory on the server that owns the selected project.

A mouse or pen press on an Explorer entry SHALL start a drag as soon as the
pointer moves. A touch press SHALL NOT start a drag until the touch has been
held on the entry, without moving, for one second; a touch that moves before
then SHALL scroll the Explorer instead. Once a touch hold has armed a drag, the
Explorer SHALL show that the entry is armed, and moving the touch SHALL drag the
entry without scrolling the Explorer. Releasing an armed touch without moving
SHALL open that entry's context menu at the touch point. The platform's own
touch long-press menu SHALL NOT open on an Explorer entry.

#### Scenario: Set root from a terminal cwd

- **WHEN** the user sets the project root from the working directory of a
  terminal
- **THEN** the path is validated on the server that owns the selected project

#### Scenario: Drag an entry to the tab area

- **WHEN** the user drags an Explorer entry onto the tab area
- **THEN** that file or folder opens as a tab

#### Scenario: Touch and move within one second scrolls

- **WHEN** the user touches an Explorer entry and moves the touch before one
  second has passed
- **THEN** the Explorer scrolls with the touch
- **AND** no entry drag starts and no entry is opened

#### Scenario: Touch held still for one second then moved drags the entry

- **WHEN** the user touches an Explorer entry, holds it still for one second,
  and then moves the touch
- **THEN** the entry is dragged with the touch and the Explorer does not scroll
- **AND** releasing over the tab area opens that file or folder as a tab

#### Scenario: Touch held still for one second then released opens the context menu

- **WHEN** the user touches an Explorer entry, holds it still for one second,
  and releases without moving
- **THEN** that entry's context menu opens at the touch point
- **AND** the entry is not opened

#### Scenario: Quick tap still activates the entry

- **WHEN** the user taps an Explorer entry and releases before one second
  without moving
- **THEN** the entry is activated exactly as a mouse click activates it

#### Scenario: Mouse press and move drags immediately

- **WHEN** the user presses an Explorer entry with a mouse and moves it
- **THEN** the entry drag starts without any hold delay
