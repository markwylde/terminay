## ADDED Requirements

### Requirement: Focus and same-size resizes are not activity

Focusing a terminal, leaving it, or making it the presentation that controls it SHALL NOT change its activity state on any platform. A resize request for the size a terminal's PTY already has SHALL be authorized as any resize is, and SHALL then reach neither the PTY nor any resize observer, so a pseudo-console that repaints on every resize produces no output for it.

#### Scenario: Clicking between idle terminals on Windows

- **WHEN** a user on Windows clicks back and forth between two idle PowerShell terminals in the raw-output tier
- **THEN** neither terminal's tab shows an amber or green indicator

#### Scenario: Same-size resize

- **WHEN** a client with write access asks to resize an 80×24 terminal to 80×24
- **THEN** the PTY receives no resize and emits no repaint

#### Scenario: Changed size still resizes

- **WHEN** a client with write access asks to resize an 80×24 terminal to 100×30
- **THEN** the PTY is resized to 100×30

#### Scenario: Unauthorized same-size resize

- **WHEN** a client without write access to a terminal asks to resize it to its current size
- **THEN** the request is refused as any unauthorized resize is
