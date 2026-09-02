## ADDED Requirements

### Requirement: Contiguous checkpoint-to-live transition
Presentation recovery SHALL move from a valid checkpoint to live output with no gap and no
duplicated bytes. A post-gap client SHALL restart from a valid presentation state rather than
resuming at an arbitrary retained-output offset.

#### Scenario: Post-gap recovery
- **WHEN** a client recovers after a discontinuity
- **THEN** it hydrates from a valid checkpoint and receives every later output byte exactly once

### Requirement: Input and lease handling during recovery
Interactive presentation ownership SHALL be preserved across recovery, and a recovering
non-holder SHALL NOT gain the ability to send input or automatic terminal responses.

#### Scenario: Lease survives recovery
- **WHEN** the transport recovers for a session with an existing lease holder
- **THEN** the holder keeps control and other clients remain read-only
