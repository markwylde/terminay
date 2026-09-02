## ADDED Requirements

### Requirement: Contiguous checkpoint-to-live transition
Hydration positions SHALL be contiguous. Overlap, gap, checkpoint-token
mismatch, expiry, or buffer overflow SHALL fail the affected hydration closed
rather than producing a partially correct display. Output produced throughout
hydration SHALL be rendered exactly once.

#### Scenario: Gap between checkpoint and buffered tail
- **WHEN** the buffered tail does not begin exactly at the checkpoint position
- **THEN** hydration fails closed and the display reports a recoverable error

#### Scenario: Overlapping tail
- **WHEN** buffered output overlaps content already restored from the
  checkpoint
- **THEN** hydration fails closed rather than rendering the overlap twice

### Requirement: Bounded checkpoint catch-up
Checkpoint state SHALL be bounded by named hard limits on snapshot bytes,
parser work, retained tail, checkpoint frequency, per-session state,
pinned-checkpoint count and lifetime, and per-attachment hydration queues.
Crossing a limit SHALL fail only that fresh hydration, with a precise
recoverability error, and SHALL NOT terminate the PTY or affect an already
attached display.

#### Scenario: Oversized serialized state
- **WHEN** a session's serialized checkpoint state would exceed its limit
- **THEN** the fresh hydration is refused with a precise error
- **AND** the PTY and attached displays continue safely

#### Scenario: Parser backlog
- **WHEN** the checkpoint state queue falls behind under hostile output
- **THEN** ordinary terminal subscribers continue to receive output without
  delay

### Requirement: A display can always recover
A genuinely fresh local or remote display SHALL reconstruct the same visible
grid, alternate-screen state, cursor, modes, and canonical dimensions after
terminal output has exceeded both 1 MiB and the retained raw replay window.
Attach headers SHALL remain within protocol limits, and checkpoint data SHALL
never widen authorization or terminal-session scope.

#### Scenario: Recovery after millions of output bytes
- **WHEN** a fresh display attaches to a session that has produced many
  millions of output bytes
- **THEN** it reconstructs the same visible grid, alternate-screen state,
  cursor, modes, and dimensions

#### Scenario: Multiple observers
- **WHEN** several local and remote displays attach to the same session
- **THEN** each reconstructs the same presentation and remains interactive
  under the existing presentation lease
