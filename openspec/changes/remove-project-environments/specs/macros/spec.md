## ADDED Requirements

### Requirement: Macro writes follow the terminal's server

Macro terminal writes SHALL follow the terminal's canonical server, and file fields SHALL browse through that server's filesystem. A path SHALL never be read from a filesystem other than the one belonging to the server that owns the terminal.

#### Scenario: File field browsing

- **WHEN** a macro file field is used on a terminal
- **THEN** the field browses through the filesystem of the server that owns that terminal

#### Scenario: Writes reach the owning server

- **WHEN** a macro types its rendered steps into a terminal
- **THEN** the write goes to the server that owns that terminal
- **AND** the operation never falls back to another machine

## REMOVED Requirements

### Requirement: Macro writes follow the terminal's project environment

**Reason:** A project executes on the server that owns it, so a macro write and a macro file field have one filesystem to reach and no capability subset to test.

**Migration:** None. The surviving rule is stated by "Macro writes follow the terminal's server".
