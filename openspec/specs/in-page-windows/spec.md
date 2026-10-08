# in-page-windows Specification

## Purpose
Terminay's browser client draws its management surfaces, such as Settings, as in-page windows that share one frame: they are moved by the title bar, resized, maximised, modal, and remember their geometry per browser.

## Requirements

### Requirement: One frame for every in-page window

Every window or dialog that Terminay presents inside the page SHALL be drawn in one shared frame: a title bar that shows the window's title and a close button at its trailing end, above a body that holds the window's content. The frame SHALL supply the border, corner radius, shadow, and backdrop, and a window's content SHALL NOT draw a second frame, a second title, or its own close control. This applies to Settings, Macros, Recordings, Remote Control, About, Edit Tab, Edit Project, MCP install, remote pairing, worktree sign-in, and the application update dialog. Confirmation prompts, the Command Bar, and the compact switcher are not in-page windows.

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

### Requirement: Windows are moved by their title bar

A user SHALL be able to move an in-page window by dragging its title bar with a mouse, pen, or touch. The window SHALL follow the pointer for the whole drag, including while the pointer is over embedded content or outside the window. A window SHALL NOT be movable to a place where its title bar cannot be reached: the whole title bar height and at least 160 px of its width SHALL stay inside the viewport. A press on a title bar control SHALL activate that control and SHALL NOT start a drag.

#### Scenario: Dragging a window aside

- **WHEN** a user drags the title bar of the Settings window 200 px to the right
- **THEN** the window moves 200 px to the right and stays there on release

#### Scenario: Dragging past the edge

- **WHEN** a user drags a window's title bar beyond the top or far past a side of the viewport
- **THEN** the window stops with its title bar fully below the top edge and at least 160 px of the title bar inside the viewport

#### Scenario: Dragging over embedded content

- **WHEN** a user drags the About window and the pointer passes over the About artwork
- **THEN** the window keeps following the pointer until release

#### Scenario: Pressing close

- **WHEN** a user presses the close button in a title bar and releases on it
- **THEN** the window closes and does not move

### Requirement: Management windows are resized from edges and corners

Settings, Macros, Recordings, and Remote Control SHALL be resizable by dragging any edge or corner. The edge opposite the one dragged SHALL stay where it is. A window SHALL NOT become smaller than 480 px wide or 320 px high, and SHALL NOT be resized beyond the viewport. The pointer SHALL show the matching resize cursor over each edge and corner. About, Edit Tab, Edit Project, and the small dialogs SHALL take the size of their content and SHALL offer no resize affordance.

#### Scenario: Widening from the right edge

- **WHEN** a user drags the right edge of the Settings window 150 px to the right
- **THEN** the window becomes 150 px wider and its left edge does not move

#### Scenario: Resizing from a corner

- **WHEN** a user drags the top-left corner of the Recordings window up and to the left
- **THEN** the window grows in both directions and its bottom-right corner does not move

#### Scenario: Shrinking past the minimum

- **WHEN** a user drags an edge of a management window inward past its minimum size
- **THEN** the window stops at 480 px wide or 320 px high

#### Scenario: A content-sized window

- **WHEN** a user moves the pointer over the edges of the About window or the Edit Tab window
- **THEN** no resize cursor appears and dragging an edge does not change the window's size

### Requirement: Management windows maximise and restore

The title bar of Settings, Macros, Recordings, and Remote Control SHALL carry a maximise button beside the close button. Activating it, or double-clicking the title bar, SHALL make the window fill the viewport. Activating it again, or double-clicking the title bar again, SHALL return the window to the size and position it had before. A maximised window SHALL NOT be moved or resized. Content-sized windows SHALL NOT have a maximise button and SHALL NOT respond to a double-click on the title bar.

#### Scenario: Maximising

- **WHEN** a user activates the maximise button on the Settings window
- **THEN** the window fills the viewport and the button indicates that it now restores

#### Scenario: Restoring

- **WHEN** a user double-clicks the title bar of a maximised window
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

- **WHEN** a user opens Macros from a menu and presses Escape
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

- **WHEN** the remote pairing dialog is opened from the Remote Control window and the user presses Escape
- **THEN** the pairing dialog closes and the Remote Control window stays open

### Requirement: Management window geometry is remembered per browser

The size, position, and maximised state of each of Settings, Macros, Recordings, and Remote Control SHALL be remembered separately, per browser profile, and restored the next time that window opens, including after a reload. A remembered geometry SHALL be corrected to the current viewport before it is used, so the window opens fully reachable and no larger than the viewport. A window with no remembered geometry SHALL open centred at its default size. Content-sized windows SHALL open centred every time. Remembered geometry SHALL contain only numbers and the maximised flag, SHALL NOT be sent to any server, and SHALL be optional: when browser storage is unavailable the window SHALL open at its default and work normally.

#### Scenario: Reopening after a reload

- **WHEN** a user resizes and moves the Settings window, closes it, reloads the page, and opens Settings again
- **THEN** the window opens at the size and position it was left at

#### Scenario: Each window keeps its own geometry

- **WHEN** a user resizes Settings and then opens Recordings for the first time
- **THEN** Recordings opens centred at its default size

#### Scenario: Remembered geometry no longer fits

- **WHEN** a window was left at 1400 px wide and is next opened in a browser 1000 px wide
- **THEN** it opens no wider than the viewport with its title bar fully visible

#### Scenario: Storage is unavailable

- **WHEN** browser storage is disabled and a user opens Settings
- **THEN** the window opens centred at its default size and can be moved, resized, and closed

#### Scenario: An edit dialog reopens centred

- **WHEN** a user moves the Edit Tab window, closes it, and opens it again
- **THEN** it opens centred

### Requirement: Windows follow the viewport

An open in-page window SHALL stay reachable as the viewport changes. When the viewport shrinks, the window SHALL be moved and, if needed, made smaller so it stays inside. While the viewport is at or below the compact breakpoint, every in-page window SHALL fill the viewport, SHALL keep its title bar and close button, and SHALL offer no move, resize, or maximise affordance. A content-sized window whose content is taller than the viewport SHALL be limited to the viewport and scroll its body, keeping the title bar in place. Opening and closing transitions SHALL be omitted when the user prefers reduced motion.

#### Scenario: Shrinking the browser

- **WHEN** a window sits near the right edge and the browser is made narrower than the window's right edge
- **THEN** the window moves left to stay inside the viewport, and becomes narrower only when it no longer fits at its width

#### Scenario: Compact viewport

- **WHEN** a user opens Settings on a phone-width viewport
- **THEN** it fills the viewport with a title bar and close button, shows no maximise button, and cannot be dragged or resized

#### Scenario: Crossing the breakpoint and back

- **WHEN** a window is open and the viewport is narrowed past the compact breakpoint and then widened again
- **THEN** the window fills the viewport while compact and returns to its previous size and position afterwards

#### Scenario: Tall content in a short viewport

- **WHEN** the Edit Tab window is opened in a viewport shorter than its content
- **THEN** the window is no taller than the viewport, its title bar stays visible, and its body scrolls

#### Scenario: Reduced motion

- **WHEN** a user who prefers reduced motion opens or closes a window
- **THEN** it appears and disappears without animation
