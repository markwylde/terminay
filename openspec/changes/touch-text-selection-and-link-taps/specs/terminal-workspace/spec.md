## MODIFIED Requirements

### Requirement: Touch input and software keyboard accessory

On touch devices, xterm SHALL own scrollback and the terminal mouse and key sequences required by interactive TUIs; Terminay SHALL NOT translate or suppress touch input over the xterm surface, except for the remainder of a gesture that has entered text selection. A synchronous, non-cancelling touch focus bridge SHALL focus xterm's helper textarea so iOS can present its software keyboard, and that bridge SHALL claim focus only for a tap — a touch that is released without travelling beyond a small movement threshold. A touch that scrolls, drags, or is cancelled SHALL NOT focus the terminal and SHALL NOT cause a software keyboard to be presented. While that keyboard is visible and the keyboard focus is inside the terminal's panel, Terminay SHALL present a compact accessory row immediately above it for Escape, Tab, Control, Shift, and Alt modifiers, arrow keys, Enter, Paste, and keyboard dismissal. Each modifier SHALL behave like Shift on the iOS keyboard: one tap applies it to the next input only, a second tap locks it on for every input until a third tap releases it, and each state SHALL be visibly distinct on the key. Dismissing the keyboard from the accessory SHALL release every modifier, locked or not. While the keyboard is visible for anything outside the panel, such as a text field in an app window, the accessory row SHALL NOT be shown. The accessory SHALL send its bytes through the terminal panel's normal input boundary and SHALL NOT implement scrolling or gesture translation.

#### Scenario: Touching the terminal on iOS

- **WHEN** a user touches the xterm surface on a touch device and releases without moving beyond the movement threshold
- **THEN** a synchronous, non-cancelling focus bridge focuses xterm's helper textarea so the software keyboard appears
- **AND** touch input over the surface is neither translated nor suppressed

#### Scenario: Scrolling the terminal does not raise the keyboard

- **WHEN** a user touches the xterm surface, moves beyond the movement threshold, and releases
- **THEN** the terminal is not focused and no software keyboard is presented
- **AND** xterm scrolls the buffer for that gesture as it would for any other touch pan

#### Scenario: Cancelled touch claims nothing

- **WHEN** a touch over the xterm surface is cancelled before it is released
- **THEN** the terminal is not focused and no software keyboard is presented

#### Scenario: Scrolling an already-focused terminal keeps it focused

- **WHEN** the terminal already holds focus and the user scrolls it by touch
- **THEN** the terminal remains focused
- **AND** a software keyboard that was already visible is not dismissed

#### Scenario: Focus is claimed on release, within the activating gesture

- **WHEN** the focus bridge claims focus for a tap
- **THEN** it does so while the releasing touch event is still in flight, so a platform that gates software-keyboard presentation on a trusted user gesture still presents one

#### Scenario: Accessory row in use

- **WHEN** the software keyboard is visible and the user activates an accessory control
- **THEN** its bytes are sent through the terminal panel's normal input boundary
- **AND** the accessory implements no scrolling or gesture translation

#### Scenario: One tap modifies the next input only

- **WHEN** the user taps Control once and then types `c` and `d`
- **THEN** `c` is sent as Control-C and `d` is sent unmodified
- **AND** the Control key no longer shows as active

#### Scenario: Two taps lock a modifier

- **WHEN** the user taps Control twice and then types `c` and `d`
- **THEN** both are sent with Control applied
- **AND** the Control key shows as locked, distinct from the one-shot state, until the user taps it a third time

#### Scenario: Dismissing the keyboard releases modifiers

- **WHEN** a modifier is one-shot or locked and the user dismisses the keyboard from the accessory row
- **THEN** every modifier is released

#### Scenario: Keyboard raised by a field in an app window

- **WHEN** the user taps a text field inside an app window and the software keyboard appears
- **THEN** the terminal's accessory row is not shown
- **AND** it is shown again when the user taps the terminal

### Requirement: Terminal link and input safety

Terminal content SHALL be treated as untrusted text. Modifier-clicking a detected or OSC-8 HTTP or HTTPS link SHALL open that credential-free URL in the system browser; other schemes and URLs with credentials SHALL be rejected. A pointer device SHALL require a modifier click to open a link. A touch tap on a link SHALL NOT open it; it SHALL show a link menu with **Copy Text**, which copies the link's visible text, **Copy Link**, which copies its URL, and **Open Link**, which opens it as a modifier-click does. On iOS and Android the menu SHALL also offer **Open in Browser**, which hands a credential-free HTTP or HTTPS URL to the platform browser app through its URL scheme so it opens outside an installed web app. A tap on a link SHALL NOT focus the terminal, and SHALL be recognised whatever the foreground program is doing without reaching that program as a button report it never saw pressed. A browser client SHALL open an external URL and write the clipboard within the user activation that requested it. Paste and external drop behaviour SHALL remain user initiated. Screen-reader and reduced-motion settings SHALL be honoured. Secrets typed in a terminal SHALL NOT be collected by default; recording has its own explicit policy.

#### Scenario: Modifier-clicking a link

- **WHEN** a user modifier-clicks a detected `http://` or `https://` terminal link, including an OSC-8 hyperlink
- **THEN** that credential-free URL opens in the system browser

#### Scenario: Clicking a link without a modifier

- **WHEN** a user clicks a terminal link with a pointer device and holds no modifier
- **THEN** the link is not opened

#### Scenario: Tapping a link on touch

- **WHEN** a user taps a terminal link on a touch device
- **THEN** the link is not opened and the terminal is not focused
- **AND** a menu offers Copy Text, Copy Link, and Open Link

#### Scenario: Copying an OSC-8 hyperlink's text

- **WHEN** a user taps an OSC-8 hyperlink and chooses Copy Text
- **THEN** the clipboard receives the text shown in the terminal, not the URL

#### Scenario: Opening in the platform browser

- **WHEN** a user on iOS or Android taps an `https://` link and chooses Open in Browser
- **THEN** the URL is opened through the platform browser's URL scheme rather than an in-app sheet

#### Scenario: Unsafe link

- **WHEN** a terminal link uses another scheme or contains credentials
- **THEN** opening it is rejected

#### Scenario: Tapping a link inside a mouse tracking program

- **WHEN** a user taps a terminal link while the foreground program is in mouse tracking mode
- **THEN** the link menu is shown
- **AND** no button report the program never saw pressed is sent

#### Scenario: Opening a link from a browser client

- **WHEN** a browser client opens a terminal link or copies a selection
- **THEN** the browser is asked within the user activation that requested it, so a browser that gates windows and the clipboard on a live activation still honours the request

## ADDED Requirements

### Requirement: Touch text selection by hold

A touch held stationary over the xterm surface for one second SHALL enter text selection for the remainder of that gesture: the word under the touch SHALL be selected, subsequent movement SHALL extend the selection, and xterm's panning SHALL be suppressed until the touch is released. A touch that travels beyond the movement threshold before the hold elapses SHALL remain a pan and SHALL NOT be translated or suppressed. A gesture that entered text selection SHALL NOT focus the terminal on release and SHALL NOT cause a software keyboard to be presented. A selection made this way SHALL offer a copy affordance, since a touch device cannot reach the terminal context menu.

Hold-to-select SHALL be governed by an **Edit > Enable Text Selection** toggle that is enabled by default and remembered per device. The preference SHALL NOT travel between devices or reach host settings. While it is disabled, a hold SHALL behave exactly as a touch that never held.

#### Scenario: Holding to select

- **WHEN** a user touches the xterm surface and holds it stationary for one second
- **THEN** the word under the touch is selected
- **AND** movement that follows extends the selection instead of panning the terminal

#### Scenario: Releasing a touch selection

- **WHEN** the user lifts the finger that made a touch selection
- **THEN** the selection remains and a copy affordance is offered for it
- **AND** the terminal is not focused and no software keyboard is presented

#### Scenario: A pan is never a selection

- **WHEN** a touch travels beyond the movement threshold before the hold elapses
- **THEN** no selection is made and xterm handles the gesture as it handles any other touch pan

#### Scenario: Holding in a mouse tracking program

- **WHEN** a user holds stationary for one second while the foreground program is in mouse tracking mode
- **THEN** the hold selects text for the length of that gesture
- **AND** the program's own drag handling is restored when the touch is released

#### Scenario: Text selection disabled

- **WHEN** Enable Text Selection is off and a user holds stationary over the terminal
- **THEN** no selection is made and the touch behaves exactly as it would without the feature

#### Scenario: The preference is per device

- **WHEN** a device changes Enable Text Selection
- **THEN** the choice is remembered for that device only and no other device attached to the workspace is affected
