## ADDED Requirements

### Requirement: Close is not delayed by unrelated terminals
A terminal close SHALL NOT await observation work belonging to any other
session. Output volume, agent work, and process-tree depth in another terminal
SHALL NOT affect the outcome or the latency of closing an idle terminal.

#### Scenario: Noisy neighbour
- **WHEN** one terminal emits output continuously and an unrelated idle
  terminal is closed
- **THEN** the close completes within its bounded deadline

### Requirement: Session-owned host observation under load
Activity projection reads SHALL remain responsive while host observation for
any session is slow, and observation work SHALL stay bounded per session under
sustained output.

#### Scenario: Sustained output with slow host inspection
- **WHEN** a session sustains high output while its host inspection is slow
- **THEN** activity projection reads still return promptly
- **AND** that session's pending observation work stays bounded
