## MODIFIED Requirements

### Requirement: Detect capability

**Detect** SHALL mean that starting the provider's CLI normally in an
interactive Terminay terminal produces an agent entry bound to that exact
terminal, visible in the Agents pane, without the user editing provider
configuration, installing a hook, or launching the CLI through a wrapper.
Detection SHALL be proven by the provider's documented terminal identity
evidence and SHALL NOT rest on a process name alone.

A provider whose evidence is not yet present SHALL report `not-bound` naming
every directory in which that evidence will appear, so that its appearance
re-runs detection. A provider SHALL NOT report `not-bound` with an empty wait
set while its CLI process is running in the terminal. The shared harness
SHALL record every such empty result and SHALL fail the provider's Detect
cell if any occurred, and each provider's own suite SHALL prove that evidence
written after the CLI starts is named before it exists and bound once it
does.

#### Scenario: CLI launched normally

- **WHEN** a user runs a matrix provider's CLI in an interactive terminal with no configuration changes
- **THEN** an agent entry bound to that exact terminal appears in the Agents pane

#### Scenario: Process name without evidence

- **WHEN** a process matching a provider's executable name runs but its terminal identity evidence cannot be proven
- **THEN** no agent entry is created and the terminal uses terminal-activity fallback

#### Scenario: Evidence written after launch

- **WHEN** the provider's session record or journal is written after the initial detection attempt
- **THEN** the initial attempt named the directory that later received it, and the attempt run on that directory's change binds the terminal

#### Scenario: Running CLI with no wait set

- **WHEN** a provider reports `not-bound` naming no directory while its CLI process is a descendant of the terminal
- **THEN** the conformance harness fails that provider's Detect cell
