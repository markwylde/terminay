## ADDED Requirements

### Requirement: Settings geometry is remembered per browser

The size, position, and maximised state of Settings SHALL be remembered per browser profile and restored the next time Settings opens, including after a reload. A remembered geometry SHALL be corrected to the current viewport before it is used, so the window opens fully reachable and no larger than the viewport. A window with no remembered geometry SHALL open centred at its default size. Content-sized windows SHALL open centred every time. Remembered geometry SHALL contain only numbers and the maximised flag, SHALL NOT be sent to any server, and SHALL be optional: when browser storage is unavailable the window SHALL open at its default and work normally.

#### Scenario: Reopening after a reload

- **WHEN** a user resizes and moves the Settings window, closes it, reloads the page, and opens Settings again
- **THEN** the window opens at the size and position it was left at

#### Scenario: First open

- **WHEN** a user opens Settings in a browser profile that has never opened it
- **THEN** Settings opens centred at its default size

#### Scenario: Remembered geometry no longer fits

- **WHEN** a window was left at 1400 px wide and is next opened in a browser 1000 px wide
- **THEN** it opens no wider than the viewport with its title bar fully visible

#### Scenario: Storage is unavailable

- **WHEN** browser storage is disabled and a user opens Settings
- **THEN** the window opens centred at its default size and can be moved, resized, and closed

#### Scenario: An edit dialog reopens centred

- **WHEN** a user moves the Edit Tab window, closes it, and opens it again
- **THEN** it opens centred

## REMOVED Requirements

### Requirement: Management window geometry is remembered per browser

**Reason**: Settings is the only management window, so geometry is no longer kept per window.
**Migration**: Settings keeps its geometry under "Settings geometry is remembered per browser".

## RENAMED Requirements

- FROM: `### Requirement: Management windows are resized from edges and corners`
- TO: `### Requirement: Settings is resized from edges and corners`

- FROM: `### Requirement: Management windows maximise and restore`
- TO: `### Requirement: Settings maximises and restores`

## MODIFIED Requirements

### Requirement: One frame for every in-page window

Every window or dialog that Terminay presents inside the page SHALL be drawn in one shared frame: a title bar that shows the window's title and a close button at its trailing end, above a body that holds the window's content. The frame SHALL supply the border, corner radius, shadow, and backdrop, and a window's content SHALL NOT draw a second frame, a second title, or its own close control. This applies to Settings, About, Edit Tab, Edit Project, MCP install, remote pairing, worktree sign-in, and the application update dialog. Confirmation prompts, the Command Bar, and the compact switcher are not in-page windows.

#### Scenario: Settings in a browser

- **WHEN** a user opens Settings on a host without native windows
- **THEN** it appears in the shared frame with a title bar reading "Settings" and a close button, and the content shows no second "Settings" heading or "Close" button

#### Scenario: About

- **WHEN** a user opens About Terminay on a host without native windows
- **THEN** it appears in the shared frame with a title bar and a close button, and the close button does not overlap the artwork

#### Scenario: Editing a tab or project

- **WHEN** a user opens Edit Tab or Edit Project in the page
- **THEN** it appears in the shared frame with a title bar naming what is being edited and a close button

#### Scenario: A small dialog

- **WHEN** the MCP install, remote pairing, worktree sign-in, or application update dialog opens
- **THEN** it appears in the shared frame, identical in title bar, border, radius, shadow, and backdrop to every other in-page window

### Requirement: Settings is resized from edges and corners

Settings SHALL be resizable by dragging any edge or corner. The edge opposite the one dragged SHALL stay where it is. Settings SHALL NOT become smaller than 480 px wide or 320 px high, and SHALL NOT be resized beyond the viewport. The pointer SHALL show the matching resize cursor over each edge and corner. About, Edit Tab, Edit Project, and the small dialogs SHALL take the size of their content and SHALL offer no resize affordance.

#### Scenario: Widening from the right edge

- **WHEN** a user drags the right edge of the Settings window 150 px to the right
- **THEN** the window becomes 150 px wider and its left edge does not move

#### Scenario: Resizing from a corner

- **WHEN** a user drags the top-left corner of the Settings window up and to the left
- **THEN** the window grows in both directions and its bottom-right corner does not move

#### Scenario: Shrinking past the minimum

- **WHEN** a user drags an edge of the Settings window inward past its minimum size
- **THEN** the window stops at 480 px wide or 320 px high

#### Scenario: A content-sized window

- **WHEN** a user moves the pointer over the edges of the About window or the Edit Tab window
- **THEN** no resize cursor appears and dragging an edge does not change the window's size

### Requirement: Settings maximises and restores

The title bar of Settings SHALL carry a maximise button beside the close button. Activating it, or double-clicking the title bar, SHALL make Settings fill the viewport. Activating it again, or double-clicking the title bar again, SHALL return the window to the size and position it had before. A maximised window SHALL NOT be moved or resized. Content-sized windows SHALL NOT have a maximise button and SHALL NOT respond to a double-click on the title bar.

#### Scenario: Maximising

- **WHEN** a user activates the maximise button on the Settings window
- **THEN** the window fills the viewport and the button indicates that it now restores

#### Scenario: Restoring

- **WHEN** a user double-clicks the title bar of a maximised Settings window
- **THEN** the window returns to the size and position it had before it was maximised

#### Scenario: No maximise on About

- **WHEN** a user opens About Terminay
- **THEN** its title bar shows a close button and no maximise button

### Requirement: In-page windows are modal

An open in-page window SHALL be modal. A dimmed backdrop SHALL cover the rest of the page, the page behind SHALL NOT receive pointer or keyboard input, and keyboard focus SHALL stay inside the window. Opening a window SHALL move focus into it. Pressing Escape, activating the close button, or pressing the backdrop SHALL close the window, and closing SHALL return focus to the element that had it before the window opened. While a window is carrying out work that must finish, it SHALL NOT close by any of the three. A press that begins inside the window and ends on the backdrop SHALL NOT close it. A dialog opened from inside a window SHALL be presented above that window, and only the topmost SHALL receive input and respond to Escape.

#### Scenario: The page behind is inert

- **WHEN** Settings is open and a user presses Tab repeatedly
- **THEN** focus cycles through the controls of the Settings window and never reaches the workspace behind

#### Scenario: Escape closes and focus returns

- **WHEN** a user opens Settings from a menu and presses Escape
- **THEN** the window closes and focus returns to the control that opened it

#### Scenario: Pressing the backdrop

- **WHEN** a user presses the backdrop outside an open window
- **THEN** the window closes

#### Scenario: A resize that ends outside the window

- **WHEN** a user starts dragging a window's edge and releases the pointer over the backdrop
- **THEN** the window stays open at its new size

#### Scenario: A window that is busy

- **WHEN** the worktree sign-in window is saving a token and the user presses Escape or the backdrop
- **THEN** the window stays open and its close button is disabled until the save finishes

#### Scenario: A dialog over a window

- **WHEN** the remote pairing dialog is opened from Remote Access in Settings and the user presses Escape
- **THEN** the pairing dialog closes and Settings stays open

