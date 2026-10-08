## MODIFIED Requirements

### Requirement: Workspace views as native windows

Desktop SHALL present workspace views as native windows. Project tabs SHALL be draggable between them, while web clients manage the same views in-page. Dragging a tab into another native window SHALL attach that tab's server to the destination window if it is not attached already. Moving a project SHALL preserve its panels, live PTYs, scrollback, and service identities.

While a torn-off project tab is held over another native window's project bar, that window SHALL show the tab in its strip at the pointer's position with its other tabs making room, and the floating drag preview SHALL be hidden for as long as a strip shows the tab. Moving the pointer along the bar SHALL move the shown tab with it; moving off the bar SHALL remove it from the strip and restore the floating preview. Releasing over the bar SHALL place the project at the shown position, SHALL make it that window's active project, and SHALL bring that window to the front with keyboard focus. The shown position SHALL be a position in that window's client-owned tab order.

#### Scenario: Dragging a project between windows
- **WHEN** a project tab is dragged into another native window
- **THEN** its panels, live PTYs, scrollback, and service identities are preserved

#### Scenario: Destination window has not attached that server
- **WHEN** a project tab is dragged into a native window that has not attached its server
- **THEN** the destination window attaches that server and the project moves within its own server's views

#### Scenario: Holding a tab over another window's bar
- **WHEN** a torn-off project tab is held over another native window's project bar
- **THEN** that window shows the tab in its strip at the pointer and the floating drag preview is hidden

#### Scenario: Leaving the bar without dropping
- **WHEN** the pointer leaves that bar while the tab is still held
- **THEN** the strip no longer shows the tab and the floating drag preview returns

#### Scenario: Dropping at a position
- **WHEN** the tab is released over that bar before one of its tabs
- **THEN** the project sits immediately before that tab, is the window's active project, and the window has keyboard focus

#### Scenario: Dropping after the last tab
- **WHEN** the tab is released over that bar to the right of every tab
- **THEN** the project is the last tab and is the window's active project

## ADDED Requirements

### Requirement: Tear-off is repeatable

Tearing a project tab off SHALL leave every window involved able to tear off again. A window's torn-off presentation of a dragged tab SHALL last no longer than the drag that caused it: when a project drag ends — by release as a reorder, a merge into another window, or a new window, or because the drag was abandoned — the source window SHALL show none of its tabs as torn off, and the next drag from that window SHALL begin as an in-strip drag. A project tab of any displayed width SHALL be able to start a native tear-off. A native tear-off the host refuses to start SHALL be recorded as a diagnostic and SHALL leave the drag as an in-strip reorder.

#### Scenario: Second tear-off from the same window
- **WHEN** a user tears one project off into a new window and then drags another project tab out of the source window's bar
- **THEN** the second project also opens in a new window

#### Scenario: Out, back in, and out again
- **WHEN** a user tears a project off into a new window, drags it back onto the source window's bar, and then drags it out of that bar again
- **THEN** the project opens in a new window again

#### Scenario: Reorder after a tear-off
- **WHEN** a user drags a tab along the strip in a window that has previously been the source of a tear-off
- **THEN** the dragged tab stays visible in the strip at its full width while it is dragged

#### Scenario: Narrow tab
- **WHEN** a user drags a project tab narrower than the smallest drag preview out of the bar
- **THEN** native tear-off begins with a drag preview of the smallest size
