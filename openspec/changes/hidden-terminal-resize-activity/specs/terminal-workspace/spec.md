## ADDED Requirements

### Requirement: Terminals off screen do not resize their PTY

A mounted terminal whose project or folder workspace is not the one on screen SHALL NOT fit its emulator to its panel or submit a PTY resize, whatever happens to the window's size meanwhile. When that workspace comes on screen, the terminal SHALL fit to its panel and, if it controls the session and its grid differs from the PTY's, submit one resize with the settled dimensions. A pending forced fit, such as one from initial ownership or takeover, SHALL be kept and performed when the terminal comes on screen.

#### Scenario: Window resized while a project is in the background

- **WHEN** the window changes size while a terminal's project is in the background
- **THEN** that terminal's PTY receives no resize

#### Scenario: Background project brought forward

- **WHEN** the user brings forward a project whose terminal's panel size changed while it was in the background
- **THEN** the terminal fits its panel and submits one resize for its new grid
