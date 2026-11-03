## ADDED Requirements

### Requirement: Held terminal presentation survives recovery

A running terminal retained by a presentation-capable holder SHALL recover its screen, active buffer, cursor, mouse tracking and encoding, bracketed paste, and focus reporting before a fresh client becomes interactive. Recovery SHALL preserve terminal identity, the running process, canonical geometry, and real PTY byte positions independently of the bounded raw-output window.

#### Scenario: Startup setup is older than retained history

- **WHEN** an interactive terminal's setup bytes have left the holder's raw replay window and its server restarts
- **THEN** the same running process receives clicks, wheel events, and keyboard input through its recovered presentation
- **AND** wheel gestures do not scroll terminal history while the program has mouse tracking enabled

#### Scenario: Modes change while no server is attached

- **WHEN** a held program changes input modes or switches screen buffers while its server is disconnected
- **THEN** recovery restores its latest parser-safe state and ordered output tail
- **AND** the state reflects changes made while disconnected rather than the last state observed by the server

#### Scenario: Fragmented control sequence crosses recovery

- **WHEN** the holder's latest output ends inside a control sequence or UTF-8 character
- **THEN** recovery restores a preceding parser-safe checkpoint and the exact ordered tail before subsequent live bytes
- **AND** no partial sequence is interpreted as ordinary screen text or lost

#### Scenario: Mouse capture is disabled before recovery

- **WHEN** a program has disabled mouse capture before its held terminal is recovered
- **THEN** selection and ordinary terminal scrolling remain available
- **AND** recovery does not force mouse capture or infer modes from the program's name

#### Scenario: Presentation limits are exceeded

- **WHEN** bounded presentation recovery is unavailable or invalid
- **THEN** recovery reports a presentation failure without ending or replacing the running process
- **AND** it does not silently substitute default terminal modes for unavailable state

#### Scenario: Restoration stays outside PTY output

- **WHEN** the server installs recovered presentation before admitting subsequent live output
- **THEN** restoration bytes do not become PTY output, input, recordings, or activity
- **AND** later raw output and resize transitions take effect once in their original order
