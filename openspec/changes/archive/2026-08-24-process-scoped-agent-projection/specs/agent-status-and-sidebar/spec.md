## ADDED Requirements

### Requirement: Process-scoped live projection
Every agent snapshot SHALL carry an ephemeral process instance id minted by the agent status
service at construction. A client SHALL pin the first process instance id it observes and
SHALL ignore snapshots stamped with a different id until it is explicitly reset. A second
live Terminay process SHALL NOT populate this process's Agents pane, even when it shares a
provider data root or restored project and session labels.

#### Scenario: Second live process is ignored
- **WHEN** another live Terminay process sharing the same provider data root publishes agent
  snapshots
- **THEN** this process's Agents pane ignores them and shows only its own agents

#### Scenario: Mismatched snapshots are dropped at the renderer
- **WHEN** a renderer subscription receives a snapshot whose process instance id differs from
  the pinned id
- **THEN** the snapshot is dropped rather than merged into the pane

### Requirement: Wrapper foregrounds start discovery
Agent discovery SHALL start on every non-shell foreground process, including `node` and
`bun` wrapper processes. Binding SHALL still require process-tree evidence together with a
writable provider journal.

#### Scenario: Wrapper-launched resume binds
- **WHEN** an agent session is resumed through a `node` wrapper in a terminal
- **THEN** discovery starts on that foreground and binds once process-tree and writable
  journal proof are available

#### Scenario: Retry stays with the attempted provider
- **WHEN** discovery on a wrapper foreground has not yet observed the journal
- **THEN** it retries the same provider rather than rotating to another one

### Requirement: Renewable root binding within an immutable process boundary
Topology polling SHALL rebind the observer when descendant or open-file identity changes,
and SHALL cancel the observer when the writing process leaves this terminal's PTY tree.
Admission diagnostics SHALL include a bounded host reason so a failed admission is
explainable rather than an opaque failure class.

#### Scenario: Writer leaves the PTY tree
- **WHEN** the process writing a bound journal is no longer a descendant of this terminal
- **THEN** the observer is cancelled and the terminal reports no bound agent

#### Scenario: Admission failure carries a reason
- **WHEN** agent admission fails because a host operation throws
- **THEN** the diagnostics report a bounded reason describing the failure
