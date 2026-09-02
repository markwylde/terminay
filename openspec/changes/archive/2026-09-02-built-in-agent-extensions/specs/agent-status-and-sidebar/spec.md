## ADDED Requirements

### Requirement: Agent authority isolation between server instances

Every agent lifecycle entry SHALL belong to exactly one server authority. Two concurrent Terminay Server compositions — two isolated Desktop profiles, or two standalone servers — MAY use the same project display name, project id, terminal session id, provider session id, and extension package, and an entry admitted by one authority SHALL NOT appear in the other authority's snapshot or subscription. An extension host SHALL accept only a context minted by its own selected server runtime; a matching context value from another server or profile SHALL NOT publish, observe, cancel, or subscribe across that runtime.

#### Scenario: Identical identifiers in two profiles

- **WHEN** two isolated profiles open identically named projects with identical terminal and provider session ids and each admits an agent
- **THEN** each profile's Agents surface renders only its own lifecycle state

#### Scenario: Foreign context value

- **WHEN** an extension presents a context value minted by another server runtime or profile
- **THEN** it cannot publish, observe, cancel, or subscribe through the current runtime

### Requirement: Immutable scope fencing for agent operations

Publication, acknowledgement, replay, and observation resolution SHALL each require the exact server, project, terminal session, and terminal incarnation issued by the owning authority. Equal project names and reused terminal ids SHALL NOT substitute for a server-instance match. A stale shell foreground transition SHALL revoke the claim, the incarnation, its timers, and every context it owns before any of them can publish, and the extension child SHALL receive that cancellation.

#### Scenario: Reused terminal id

- **WHEN** an operation presents a terminal id that matches by value but belongs to another server instance
- **THEN** the operation is refused

#### Scenario: Foreground transition revokes a claim

- **WHEN** the shell's foreground process changes away from a bound provider
- **THEN** the claim, incarnation, timers, and owned contexts are revoked before any further publication and the extension child is cancelled

### Requirement: Bounded lifecycle publication flow control

Canonical lifecycle publication SHALL be flow-controlled per context. A publication batch SHALL be validated in full before the store is mutated, so an invalid transition leaves the store and the canonical sequence unchanged. Publications for one context SHALL be serialized, the queue depth and batch size SHALL be bounded, and an acknowledgement deadline SHALL expire a stalled publication and the work queued behind it. An overflowing context SHALL be rejected without a store call. A retried publication id SHALL be coalesced to one acknowledgement, and a retry that arrives after retirement SHALL reach neither the store nor an unrelated provider. Canonical revisions and sequences SHALL remain monotonic throughout.

#### Scenario: Invalid transition inside a batch

- **WHEN** a publication batch contains an invalid transition
- **THEN** the whole batch is rejected and neither the store nor the canonical sequence changes

#### Scenario: Queue overflow

- **WHEN** a context exceeds its bounded publication queue
- **THEN** the publication is rejected without a store call

#### Scenario: Stalled acknowledgement

- **WHEN** a publication is not acknowledged within its deadline
- **THEN** it and the publications queued behind it expire

#### Scenario: Late retry after retirement

- **WHEN** a retried publication arrives after its context is retired
- **THEN** it reaches neither the canonical store nor any unrelated provider
