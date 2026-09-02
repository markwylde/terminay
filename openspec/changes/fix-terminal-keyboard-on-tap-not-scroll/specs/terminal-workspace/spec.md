## MODIFIED Requirements

### Requirement: Touch input and software keyboard accessory

On touch devices, xterm SHALL own scrollback and the terminal mouse and key sequences required by interactive TUIs; Terminay SHALL NOT translate or suppress touch input over the xterm surface. A synchronous, non-cancelling touch focus bridge SHALL focus xterm's helper textarea so iOS can present its software keyboard, and that bridge SHALL claim focus only for a tap — a touch that is released without travelling beyond a small movement threshold. A touch that scrolls, drags, or is cancelled SHALL NOT focus the terminal and SHALL NOT cause a software keyboard to be presented. While that keyboard is visible, Terminay SHALL present a compact accessory row immediately above it for Escape, Tab, one-shot Control, Shift, and Alt modifiers, arrow keys, Enter, Paste, and keyboard dismissal. The accessory SHALL send its bytes through the terminal panel's normal input boundary and SHALL NOT implement scrolling or gesture translation.

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
