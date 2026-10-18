## ADDED Requirements

### Requirement: Input survives an attachment handoff

A terminal panel MAY replace its own attachment while it stays mounted: when its stream recovers from a skip, when a resume is refused, when its connection is replaced, and when it first attaches. That replacement SHALL NOT discard input. Input typed into the panel while the replacement attaches, and input already queued and not yet sent, SHALL be held and delivered to the PTY in the order it was typed, once each, when the replacement attachment holds the interactive presentation lease. A write already sent on the attachment being replaced SHALL settle before any later input is sent: if the server or the client refused it before it reached the PTY, the replacement SHALL send it once; if its outcome is unknown, it SHALL NOT be sent again. If the replacement attachment is a read-only observer, the held input SHALL be discarded and further input refused, as for any read-only presentation.

#### Scenario: Typing through congestion recovery

- **WHEN** a terminal's stream is ended as congested while keys are queued behind a write in flight and the user keeps typing during the recovery
- **THEN** after the replacement attachment hydrates, the PTY receives every key once, in the order typed

#### Scenario: Typing before the first presentation is known

- **WHEN** a user types into a terminal whose first attach has not yet reported its presentation
- **THEN** the keys are held and delivered once the attachment holds the presentation lease

#### Scenario: A write refused on the replaced attachment

- **WHEN** a write sent on an attachment that has since been replaced is refused before it reached the PTY
- **THEN** the replacement attachment sends it once, ahead of any later input

#### Scenario: A write whose outcome is unknown

- **WHEN** a write sent on an attachment that has since been replaced fails with an unknown outcome
- **THEN** it is not sent again and later input is delivered in order

#### Scenario: The replacement is a read-only observer

- **WHEN** the replacement attachment reports a read-only presentation
- **THEN** the held input is discarded, further input is refused, and the terminal shows its read-only presentation
