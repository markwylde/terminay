## MODIFIED Requirements

### Requirement: Lane overflow handling

When an attachment's presentation lane reaches its limit, the server SHALL stop admitting further raw output to that lane, discard only that attachment's pending presentation frames, state the discarded byte range as one ordered `skip` marker carried in that lane's own stream bounded by what the transport actually accepted, suppress further output for that attachment until it is replaced, keep the PTY, connection, workspace subscriptions, and other attachments alive, and rehydrate that display from an authoritative parser-safe checkpoint before resuming live output.

#### Scenario: Lane reaches its limit

- **WHEN** an attachment's presentation lane reaches its limit
- **THEN** further raw output to that lane stops, only that attachment's pending frames are discarded, and one ordered `skip` marker states the discarded byte range

#### Scenario: Other work during overflow

- **WHEN** one attachment overflows
- **THEN** the PTY, the connection, workspace subscriptions, and other attachments stay alive

#### Scenario: Resuming after overflow

- **WHEN** the overflowing display is replaced
- **THEN** it rehydrates from an authoritative parser-safe checkpoint before live output resumes

### Requirement: In-band discontinuity

A discontinuity SHALL always be in band. A client's stream position SHALL advance only by delivered output or by a skip naming the range it replaces, so a client never reconciles an advisory computed against a position it has already passed. Exactly one component — the delivery lane that knows what reached the wire — MAY drop presentation bytes. Reconnects SHALL state the position the display actually rendered or request a fresh presentation; no component SHALL substitute a remembered cursor of its own.

#### Scenario: Client stream position advances

- **WHEN** a client's stream position changes
- **THEN** it advanced either by delivered output or by a skip naming the range it replaces

#### Scenario: Reconnecting a display

- **WHEN** a display reconnects
- **THEN** it states the position it actually rendered or requests a fresh presentation, and no component substitutes a remembered cursor

### Requirement: Bounded checkpoint catch-up

Feeding the checkpoint authority SHALL be bounded work that trails the live head under sustained output. A fresh presentation SHALL wait for it to catch up before pinning a checkpoint, within a deadline that a terminal which never falls silent cannot exceed. If it still trails by more than a presentation lane can carry, the stream SHALL begin at the live head and the intervening range SHALL be stated as a skip.

#### Scenario: Checkpoint catches up

- **WHEN** a fresh presentation is requested while output continues
- **THEN** it waits within a bounded deadline for the checkpoint authority and pins a current checkpoint

#### Scenario: Checkpoint trails too far

- **WHEN** the checkpoint authority still trails by more than a presentation lane can carry
- **THEN** the stream begins at the live head and the intervening range is stated as a skip

### Requirement: Attach-time gaps do not re-arm hydration

A gap established while a display is attaching SHALL NOT be treated as a signal to attach again, because it is already covered by the position that attachment starts from. Only a live display that fell behind SHALL re-hydrate.

#### Scenario: Gap during attach

- **WHEN** a gap is established while a display is attaching
- **THEN** hydration does not re-arm and the display paints

#### Scenario: Live display falls behind

- **WHEN** a live streaming display falls behind
- **THEN** it re-hydrates

### Requirement: Silent latch prohibition

A display SHALL NOT be latched out of recovery. Such a failure is silent because the display keeps its connection, keeps accepting keystrokes, keeps its painted screen, and reports no error while never painting again.

#### Scenario: Display stops painting

- **WHEN** a display stops receiving new output while its connection stays open and healthy
- **THEN** the condition is observable and recovery proceeds rather than the display latching silently

### Requirement: Explicit attachment closure and suppression exit

When the server detaches an attachment for any reason other than the client's own detach request, it SHALL deliver an explicit attachment-closed skip; a stream SHALL NOT end silently while its connection remains open. Congestion suppression SHALL end when the replacement attachment attaches and only then. Suppression SHALL NOT be ended by an acknowledgement, because no output is published while suppression holds.

#### Scenario: Server-initiated detach

- **WHEN** the server detaches an attachment for a reason other than the client's detach request
- **THEN** it delivers an explicit attachment-closed skip

#### Scenario: Acknowledgement during suppression

- **WHEN** an acknowledgement arrives while congestion suppression holds
- **THEN** suppression is not lifted and only the replacement attachment attaching ends it

### Requirement: Positioning faults are never discarded

No terminal-stream component SHALL discard a positioning fault silently. A gap that reaches a client SHALL be reported and recovered from rather than swallowed into a value nothing reads again, so a stream that has stopped is observable rather than indistinguishable from an idle terminal.

#### Scenario: Injected ordering fault

- **WHEN** a server-side ordering fault is injected
- **THEN** the client surfaces an explicit recoverable failure rather than silently stopping updates

### Requirement: Repeated congestion and skip outcomes

A lane that congests, skips, and congests again SHALL recover each time on the same connection; no suppression SHALL persist after the replacement attachment attaches, and an acknowledgement alone SHALL never lift it. A renderer that stops acknowledging under sustained output SHALL produce exactly one bounded congestion and one skip, then stream again as soon as its replacement attachment attaches, even while the producer never goes idle.

#### Scenario: Renderer stops acknowledging

- **WHEN** a renderer stops acknowledging under sustained output
- **THEN** exactly one bounded congestion and one skip occur, and streaming resumes as soon as the replacement attachment attaches

#### Scenario: Repeated congestion on one connection

- **WHEN** a lane congests, skips, and congests again
- **THEN** it recovers each time on the same connection with no persisting suppression

### Requirement: Contiguous checkpoint-to-live transition

The checkpoint-to-live transition SHALL be contiguous and ordered. Output and resize events arriving during rehydration SHALL be bounded, and any second overflow SHALL repeat the same attachment-scoped recovery rather than widening memory limits or closing the application connection.

#### Scenario: Resize during rehydration

- **WHEN** output and resize events arrive during rehydration
- **THEN** they are bounded and the transition to live output remains contiguous and ordered

#### Scenario: Second overflow

- **WHEN** a lane overflows again during or after recovery
- **THEN** the same attachment-scoped recovery repeats without widening memory limits or closing the application connection

## ADDED Requirements

### Requirement: Single lane dedupe and ordering enforcement

The delivery lane SHALL be the sole place where duplicate terminal frames are dropped. A frame whose end position is at or before the lane head SHALL be dropped as a duplicate. A frame whose start position is beyond the lane head SHALL be treated as a server-side ordering violation and SHALL congest the lane with a skip rather than being dropped silently. No connection-level map of delivered terminal positions SHALL exist alongside the lane.

#### Scenario: Duplicate frame admitted

- **WHEN** a terminal frame ends at or before the lane head
- **THEN** the lane drops it as a duplicate and no other component deduplicates terminal positions

#### Scenario: Frame beyond the lane head

- **WHEN** a terminal frame starts beyond the lane head
- **THEN** the lane congests and states the intervening range as a skip rather than dropping the frame silently

### Requirement: Skip ordering is monotonic while output is contiguous

Strict contiguity SHALL be enforced on delivered output, where corruption is observable. A skip SHALL be required only to be monotonic with the client's position, because an attachment-closed skip travels the state lane and MAY overtake terminal-lane output. A skip that names a range the client has already passed SHALL advance nothing and SHALL NOT be reported as a fault.

#### Scenario: Attachment-closed skip overtakes output

- **WHEN** an attachment-closed skip reaches the client ahead of terminal-lane output it describes
- **THEN** the client advances monotonically and reports no fault

#### Scenario: Output arrives out of order

- **WHEN** delivered output does not continue from the client's position
- **THEN** the attachment closes with an observable stream-failure event rather than continuing

### Requirement: Skip exactness at the transmitted boundary

A skip's `fromPosition` SHALL be the end of the last terminal byte actually transmitted for that attachment, including the case where an in-flight delivery is retained across the discard, and its `toPosition` SHALL be the lane head. Its reason SHALL distinguish congestion, attachment closure, and a gap established while attaching.

#### Scenario: Discard with a retained in-flight delivery

- **WHEN** a lane discards its backlog while one delivery is still in flight
- **THEN** the emitted skip starts at the retained delivery's end position, not at the lane head at discard time

#### Scenario: Reason distinguishes the cause

- **WHEN** a skip is delivered
- **THEN** its reason states whether it arose from congestion, attachment closure, or a gap established during attach
