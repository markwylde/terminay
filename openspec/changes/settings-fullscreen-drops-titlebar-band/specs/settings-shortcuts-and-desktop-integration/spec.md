## ADDED Requirements

### Requirement: Auxiliary windows reserve the macOS traffic-light band only while it is shown

On macOS, a native auxiliary window SHALL keep its header below the traffic lights while they are shown. While the window is full screen, when macOS hides the traffic lights, it SHALL NOT reserve that band, and SHALL reserve it again when the window leaves full screen.

#### Scenario: Settings in full screen

- **WHEN** Settings is full screen on macOS
- **THEN** its sidebar and content headers start at the top of the window with no empty band above them

#### Scenario: Settings leaves full screen

- **WHEN** Settings leaves full screen on macOS
- **THEN** its headers sit below the traffic lights again
