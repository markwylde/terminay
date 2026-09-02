## MODIFIED Requirements

### Requirement: Initial presentation ownership

When a client creates a terminal, the server SHALL briefly reserve initial presentation ownership for that authenticated creator so reconciliation order cannot let an observing browser win a race by attaching first. The creator SHALL acquire the lease as part of its serialized attach; if it disconnects or fails to attach within the bounded reservation, the server SHALL elect an already attached write-authorized observer. For a pre-existing session with no reservation or holder, the first write-authorized attachment SHALL acquire the lease. Initial ownership SHALL NOT be a takeover and SHALL NOT displace an existing holder.

#### Scenario: Browser attaches before the creating desktop

- **WHEN** an observing browser attaches before the creating desktop client
- **THEN** the reservation keeps initial presentation ownership for the authenticated creator

#### Scenario: Creator never attaches

- **WHEN** the creator disconnects or fails to attach within the bounded reservation
- **THEN** the server elects an already attached write-authorized observer

#### Scenario: Pre-existing session

- **WHEN** a pre-existing session has no reservation and no holder
- **THEN** the first write-authorized attachment acquires the lease without displacing anyone

### Requirement: Control bar and takeover presentation

The owning surface SHALL show no controller badge or control affordance. A write-authorized observer SHALL show takeover UI only while a different live attachment is the holder, as a full-width terminal bar reading "Another device is controlling this terminal." with a "Take back control" action. A lease conflict SHALL be normal read-only presentation state, not a connection failure. The control bar SHALL be an opaque themed layout row above the terminal viewport that reserves its own height and never covers terminal output, the cursor, or the emulator input surface. Its geometry and appearance SHALL be identical in desktop and browser renderers and SHALL remain stable across active-tab changes.

#### Scenario: Sole attachment

- **WHEN** a sole local or remote attachment owns a terminal
- **THEN** it silently owns and fills that terminal with no controller or read-only badge

#### Scenario: Another device holds the lease

- **WHEN** a different live attachment holds the presentation lease
- **THEN** the write-authorized observer sees a full-width bar reading "Another device is controlling this terminal." with a "Take back control" action
- **AND** the state is presented as normal read-only presentation, not a connection failure

### Requirement: Ownership fits and publishes the viewport

Initial ownership and explicit takeover SHALL immediately fit the terminal to the owning surface and submit its current viewport. A resize attempted before the asynchronous attach completed SHALL be retained and submitted once ownership is known, so an unshared terminal always fills its panel and never retains a stale observer viewport.

#### Scenario: Resize before attach completes

- **WHEN** a resize is attempted before the asynchronous attach has completed
- **THEN** it is retained and submitted once ownership is known
- **AND** the terminal fills its panel rather than retaining a stale observer viewport

### Requirement: Canonical PTY grid owned by the holder

The current presentation holder SHALL exclusively define the canonical PTY columns and rows. Every accepted holder resize SHALL be published to each exact terminal attachment. Read-only observers SHALL adopt that canonical grid locally, scaling it to their available panel when necessary, and their own layout observers SHALL NOT submit a resize or alter PTY dimensions. Attach and resume SHALL deliver the current canonical dimensions before replayed output. On takeover, the former holder's resize lease SHALL be released, the new holder SHALL clear any observer-size override, fit its own viewport, and immediately publish its dimensions; taking control back SHALL perform the same transition in reverse.

#### Scenario: Observer resizes its panel

- **WHEN** a read-only observer's panel changes size
- **THEN** it scales the canonical grid locally
- **AND** it submits no resize and does not alter PTY dimensions

#### Scenario: Attach delivers dimensions

- **WHEN** a client attaches or resumes
- **THEN** it receives the current canonical dimensions before replayed output

#### Scenario: Takeover

- **WHEN** an observer takes over the presentation
- **THEN** the former holder's resize lease is released, the new holder clears any observer-size override, fits its own viewport, and immediately publishes its dimensions

### Requirement: Presentation command result envelope

Presentation acquire, takeover, and renewal SHALL expose the presentation state as the standard command result payload. Because presentation state contains its own `revision`, the server handler SHALL retain the internal command-result wrapper so the dispatcher does not reinterpret that domain revision as transport metadata. The wire response SHALL contain exactly one command result envelope.

#### Scenario: Acquire returns presentation state

- **WHEN** an acquire, takeover, or renewal command returns presentation state carrying its own `revision`
- **THEN** the domain revision is not reinterpreted as transport metadata
- **AND** the wire response contains exactly one command result envelope

### Requirement: Rejected input after a control change

If control changes while emulator or keyboard bytes are already queued, a server `presentation_owner` rejection SHALL definitively mean those bytes were not delivered. The old controller SHALL discard that stale queue and remain attached as a read-only observer, and SHALL NOT show a connection error or retry action.

#### Scenario: Control changes with queued bytes

- **WHEN** a server `presentation_owner` rejection is returned for queued emulator or keyboard bytes
- **THEN** those bytes were not delivered, the old controller discards the stale queue, and it remains attached as a read-only observer
- **AND** no connection error or retry action is shown

### Requirement: Terminal journal routing

Terminal journal consumers SHALL route by the exact server, project, session, client, and attachment identity before strict event decoding. Auxiliary or other-client journal payloads SHALL NOT detach a valid terminal stream. An unknown event that does claim the exact attachment SHALL fail closed as a protocol violation.

#### Scenario: Payload for another client

- **WHEN** an auxiliary or other-client journal payload arrives
- **THEN** it does not detach the valid terminal stream

#### Scenario: Unknown event claiming the exact attachment

- **WHEN** an unrecognized event claims the exact server, project, session, client, and attachment identity
- **THEN** it fails closed as a protocol violation

### Requirement: Protected emulator environment

Every resolved Terminay PTY SHALL advertise the emulator it actually runs under with `TERM=xterm-256color` and `COLORTERM=truecolor`. Host launcher values such as `TERM=dumb` SHALL NOT cross into a terminal session, and profiles SHALL NOT weaken these protected emulator capabilities.

#### Scenario: Host launcher sets TERM=dumb

- **WHEN** the host launcher environment contains `TERM=dumb`
- **THEN** the terminal session still advertises `TERM=xterm-256color` and `COLORTERM=truecolor`

#### Scenario: Profile attempts to weaken TERM

- **WHEN** a shell profile sets a weaker `TERM` or `COLORTERM`
- **THEN** the protected emulator capabilities are preserved
