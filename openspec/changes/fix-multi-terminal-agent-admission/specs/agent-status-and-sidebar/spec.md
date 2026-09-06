## MODIFIED Requirements

### Requirement: Immutable scope fencing for agent operations

Publication, acknowledgement, replay, and observation resolution SHALL each require the exact server, project, terminal session, and terminal incarnation issued by the owning authority. Equal project names and reused terminal ids SHALL NOT substitute for a server-instance match. A stale shell foreground transition SHALL revoke the claim, the incarnation, its timers, and every context it owns before any of them can publish, and the extension child SHALL receive that cancellation.

The identifier the privileged host issues for a terminal observation context SHALL be derived from that full identity — server instance, project, terminal session, and incarnation together. Two contexts issued for different terminal sessions SHALL NOT share an identifier, whatever their incarnation counters hold. The identifier SHALL remain opaque to extensions and to clients.

#### Scenario: Reused terminal id

- **WHEN** an operation presents a terminal id that matches by value but belongs to another server instance
- **THEN** the operation is refused

#### Scenario: Foreground transition revokes a claim

- **WHEN** the shell's foreground process changes away from a bound provider
- **THEN** the claim, incarnation, timers, and owned contexts are revoked before any further publication and the extension child is cancelled

#### Scenario: Context identifiers for two terminal sessions

- **WHEN** two terminal sessions are each issued an observation context at the same incarnation
- **THEN** the two contexts carry different identifiers

## ADDED Requirements

### Requirement: Concurrent agent terminals

Terminay SHALL observe every terminal running a provider's CLI, not only the first. Where several terminals of one project each run the same provider, each SHALL be admitted, SHALL bind its own provider session, and SHALL hold its own root entry in the Agents pane with its own state, acknowledgement, and lifetime. One terminal's root SHALL NOT be displaced, retired, or restated by another terminal's admission, and closing or quitting one SHALL leave the others bound.

A terminal SHALL NOT be refused admission because another terminal is already observed. Admission refusal SHALL be reserved for a context whose own identity is already admitted — a repeat of the same terminal at the same incarnation — and SHALL NOT be reachable through two distinct terminals.

#### Scenario: Two terminals run one provider

- **WHEN** two terminals in a project each run the same provider's CLI
- **THEN** both are admitted and the Agents pane shows a root for each

#### Scenario: Terminals of different providers

- **WHEN** terminals in a project run different providers' CLIs concurrently
- **THEN** each terminal is admitted by its own provider and holds its own root

#### Scenario: One of several terminals quits

- **WHEN** one of several concurrently observed terminals quits its CLI
- **THEN** that terminal's root becomes inactive and every other terminal stays bound with its state unchanged

#### Scenario: Admission refused for an already-admitted context

- **WHEN** admission is attempted for a context identity that is already admitted
- **THEN** it is refused, and that refusal is not reachable from two distinct terminal sessions
