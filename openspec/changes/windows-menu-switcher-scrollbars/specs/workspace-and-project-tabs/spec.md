## ADDED Requirements

### Requirement: Keyboard terminal switcher chord

The keyboard terminal switcher SHALL open on a chord that the operating system leaves to the application. On Windows and Linux Desktop the chord SHALL be Ctrl+Tab to open or move forward and Ctrl+Shift+Tab to move back, and releasing Ctrl SHALL switch to the highlighted terminal. On macOS Desktop and in browser hosts the chord SHALL be Option+Tab (Alt+Tab) and Option+Shift+Tab, and releasing Option SHALL switch. The chord SHALL be claimed only with no other modifier, and it SHALL be claimed even while a terminal has focus, so the terminal never receives it. Escape SHALL close the switcher without switching. The switcher's heading SHALL name the chord and the key to release that the platform uses.

#### Scenario: Ctrl+Tab on Windows

- **WHEN** a user presses Ctrl+Tab in a Windows Desktop project window with a terminal focused
- **THEN** the terminal switcher opens with the next terminal highlighted and its heading reads Ctrl+Tab, release Ctrl to switch

#### Scenario: Release to switch

- **WHEN** the switcher is open on Windows or Linux and the user releases Ctrl
- **THEN** the highlighted terminal becomes active and the switcher closes

#### Scenario: Back with Shift

- **WHEN** the switcher is open on Windows or Linux and the user presses Ctrl+Shift+Tab
- **THEN** the highlight moves to the previous terminal

#### Scenario: macOS keeps Option+Tab

- **WHEN** a user presses Option+Tab on macOS
- **THEN** the switcher opens and its heading reads Alt+Tab, release Alt to switch, and Ctrl+Tab does not open it

#### Scenario: Other modifiers are left alone

- **WHEN** a user presses Ctrl+Alt+Tab on Windows or Linux
- **THEN** the switcher does not open and the chord is not claimed
