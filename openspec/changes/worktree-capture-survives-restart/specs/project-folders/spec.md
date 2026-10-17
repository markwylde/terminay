## ADDED Requirements

### Requirement: Worktree capture holds across a server restart

A terminal session that the server re-adopts after a restart SHALL be attributed as the creator of a worktree exactly as a terminal launched by the running server is. That includes a restart caused by an update. Attribution SHALL NOT depend on whether the terminal's shell was started before or after the current server run. A server run SHALL recognise only terminal sessions it owns, either launched or re-adopted. A session that has ended SHALL NOT be attributed again after a restart.

#### Scenario: A terminal kept across an update creates a worktree

- **WHEN** a General terminal is kept running through a server restart, and afterwards runs `git worktree add`
- **THEN** that terminal moves into the new worktree's folder, as it would have before the restart

#### Scenario: A terminal opened after the restart creates a worktree

- **WHEN** a terminal opened after a server restart runs `git worktree add`
- **THEN** that terminal moves into the new worktree's folder

#### Scenario: The previous run ended without cleaning up

- **WHEN** the previous run of the server ended without closing, leaving its socket behind, and a kept terminal then runs `git worktree add`
- **THEN** the new run is listening at the same address and that terminal is moved

#### Scenario: A session that ended before the restart

- **WHEN** a report arrives naming a terminal session that ended before the server restarted
- **THEN** no terminal is attributed and nothing moves
