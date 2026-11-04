## MODIFIED Requirements

### Requirement: Touch input and software keyboard accessory

On touch devices, xterm SHALL own scrollback and the terminal mouse and key sequences required by interactive TUIs; Terminay SHALL NOT translate or suppress touch input over the xterm surface, except for stationary TUI taps and the remainder of a gesture that has entered text selection. A stationary non-link tap that has not entered selection SHALL produce exactly one primary mouse press and release at the tapped cell when the foreground program enables mouse reporting. xterm SHALL encode those events according to the active mouse protocol; a plain terminal SHALL receive no button report. A synchronous, non-cancelling touch focus bridge SHALL focus xterm's helper textarea so iOS can present its software keyboard, and that bridge SHALL claim focus only for a tap — a touch that is released without travelling beyond a small movement threshold. A touch that scrolls, drags, or is cancelled SHALL NOT focus the terminal and SHALL NOT cause a software keyboard to be presented. While that keyboard is visible and the keyboard focus is inside the terminal's panel, Terminay SHALL present a compact accessory row immediately above it for Escape, Tab, Control, Shift, and Alt modifiers, arrow keys, Enter, Paste, and keyboard dismissal. Each modifier SHALL behave like Shift on the iOS keyboard: one tap applies it to the next input only, a second tap locks it on for every input until a third tap releases it, and each state SHALL be visibly distinct on the key. Dismissing the keyboard from the accessory SHALL release every modifier, locked or not. While the keyboard is visible for anything outside the panel, such as a text field in an app window, the accessory row SHALL NOT be shown. The accessory SHALL send its bytes through the terminal panel's normal input boundary and SHALL NOT implement scrolling or gesture translation.

#### Scenario: Touching the terminal on iOS

- **WHEN** a user touches the xterm surface on a touch device and releases without moving beyond the movement threshold
- **THEN** a synchronous, non-cancelling focus bridge focuses xterm's helper textarea so the software keyboard appears
- **AND** only a non-link tap in mouse reporting mode is translated into a primary mouse press and release

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

#### Scenario: Tapping a TUI control

- **WHEN** a user taps a non-link TUI control while mouse reporting is enabled
- **THEN** the program receives one primary press and release at that cell using its active mouse protocol

#### Scenario: Pan and selection never activate TUI controls

- **WHEN** a touch pans, is cancelled, or enters hold selection
- **THEN** the gesture produces no tap button report
- **AND** existing scrolling and selection behavior is preserved

#### Scenario: Links retain priority over TUI buttons

- **WHEN** a user taps a link inside a mouse-reporting TUI
- **THEN** the link menu appears without any tap button report reaching the program
