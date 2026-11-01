## ADDED Requirements

### Requirement: Input survives an attachment handoff

A mounted terminal panel SHALL hold ordered input through its own attachment replacement until a hydrated replacement controls presentation. A definitively refused write SHALL be sent once; confirmed writes SHALL NOT be repeated. An uncertain write and its queued successors SHALL NOT be sent again, and the interruption SHALL be visible. Read-only replacements SHALL discard held input and refuse further input.

#### Scenario: Typing through congestion recovery

- **WHEN** a terminal's stream is ended as congested while keys are queued behind a write in flight and the user keeps typing during recovery and the in-flight write confirms delivery
- **THEN** after the replacement attachment hydrates, the PTY receives every key once, in the order typed

#### Scenario: Typing before the first presentation is known

- **WHEN** a user types into a terminal whose first attach has not yet reported its presentation
- **THEN** the keys are held and delivered once the attachment holds the presentation lease

#### Scenario: A write refused on the replaced attachment

- **WHEN** a write sent on an attachment that has since been replaced is refused before it reached the PTY
- **THEN** the replacement attachment sends it once, ahead of any later input

#### Scenario: A write whose outcome is unknown

- **WHEN** a write sent on an attachment that has since been replaced fails with an unknown outcome
- **THEN** it is not sent again, queued successors are discarded, an input interruption notice is shown, and new input is accepted only after the replacement hydrates and controls presentation

#### Scenario: The replacement is a read-only observer

- **WHEN** the replacement attachment reports a read-only presentation
- **THEN** the held input is discarded, further input is refused, and the terminal shows its read-only presentation
