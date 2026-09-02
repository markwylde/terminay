## ADDED Requirements

### Requirement: Provider callbacks are scoped to one terminal and one incarnation

An agent provider SHALL expose a foreground-match callback receiving bounded safe process metadata and an observation callback receiving a context for one exact terminal and one process incarnation. A foreground match SHALL only ask Terminay to start a bounded observation attempt and SHALL NOT itself establish session ownership. The observation callback SHALL bind a provider session only through evidence obtained from the context it was given.

#### Scenario: Foreground match

- **WHEN** a provider's foreground-match callback returns a match
- **THEN** Terminay starts a bounded observation attempt and the match alone does not prove session ownership

#### Scenario: Evidence from another terminal

- **WHEN** a provider binds a session using evidence not obtained from the issued terminal context
- **THEN** the binding is refused

### Requirement: Semantic lifecycle publisher

Canonical lifecycle events SHALL be published through named publisher methods for session start, turn start, tool start, wait start, completion, metadata change, subagent start, and subagent completion, rather than through one unrestricted emit call. The publisher SHALL validate required ids, value bounds, allowed states, and metadata before anything crosses IPC, and SHALL be bound to the validated provider session it was issued for.

#### Scenario: Invalid event rejected before IPC

- **WHEN** a provider publishes an event missing a required id, exceeding a bound, or naming a state that is not allowed
- **THEN** it is rejected at the publisher before crossing IPC

#### Scenario: Publisher session scope

- **WHEN** a provider publishes through a publisher issued for one validated provider session
- **THEN** the event is attributed to that session and cannot name another

### Requirement: Host-supplied ordering and timestamps

Terminay SHALL supply ordering and occurrence time when a provider has no reliable values. A provider MAY propose a timestamp, and a proposed timestamp SHALL NOT rewind the canonical stream.

#### Scenario: Provider proposes an earlier timestamp

- **WHEN** a provider proposes an occurrence time earlier than the canonical stream has already reached
- **THEN** the canonical stream does not rewind

#### Scenario: No reliable provider time

- **WHEN** a provider record carries no reliable time
- **THEN** Terminay supplies ordering and occurrence time

### Requirement: Metadata-only updates preserve lifecycle state

A metadata change publishing a title or model SHALL preserve working, waiting, done, and active-tool state and SHALL NOT synthesise a new session or a new turn.

#### Scenario: Title changes mid-turn

- **WHEN** a provider publishes a metadata change while a turn is working with an active tool
- **THEN** the title and model update and the working, waiting, done, and active-tool state are unchanged

#### Scenario: Metadata change is not a new session

- **WHEN** a provider publishes only a metadata change
- **THEN** no new session and no new turn are created

### Requirement: Subagents require stable native identity

A provider SHALL publish a child only when its native data supplies a stable child identity, and SHALL publish a child's completion only from matching authoritative evidence. Array index, title, prompt text, and timing SHALL NOT be used as child identity.

#### Scenario: Native child without a stable id

- **WHEN** a provider's native data supplies no stable identity for a child
- **THEN** no child is published

#### Scenario: Child completion evidence

- **WHEN** a provider publishes a child's completion
- **THEN** it does so from matching authoritative evidence rather than from position, title, prompt, or timing

### Requirement: Typed unavailable outcome for unsupported environments

When a terminal's project environment does not advertise an observation capability a provider requires, the provider SHALL return a typed unavailable outcome naming a safe reason, and SHALL NOT throw a raw SSH, filesystem, or provider error into the UI. Terminay SHALL keep generic terminal activity active for that terminal.

#### Scenario: Missing environment capability

- **WHEN** a required observation capability is absent from a terminal's environment
- **THEN** the provider returns a typed unavailable outcome with a safe reason

#### Scenario: Activity continues

- **WHEN** authoritative agent observation is unavailable for a terminal
- **THEN** generic terminal activity stays active for that terminal

### Requirement: Session identity comes only from provider evidence

A display title, current working directory, timestamp, or nearest filename SHALL NOT be a provider session identity. A provider SHALL bind a session from evidence its own native data makes authoritative, and Terminay SHALL validate that every handle that evidence references was issued by the terminal context performing the binding.

#### Scenario: Binding from a title or path

- **WHEN** a provider offers a title, working directory, timestamp, or nearest filename as session identity
- **THEN** the binding is not admitted

#### Scenario: Handle provenance checked

- **WHEN** a provider binds a session referencing file or process handles
- **THEN** Terminay validates each handle was issued by that terminal context
