## ADDED Requirements

### Requirement: Disabled agent integration performs no observation

While the agent-integration setting is off, the server SHALL perform no agent
observation of any kind: no topology polling, no process enumeration, no
open-file inspection, and no journal reads. Disabling the setting SHALL cancel
observation already scheduled, not merely stop new work being admitted, so a
terminal that was being polled when the setting changed stops being polled.

Re-enabling the setting SHALL resume observation for the terminals that are
still alive, without requiring them to be restarted.

The cost of the feature SHALL therefore be zero — measured as child processes
spawned per idle second — for a user who has turned it off.

#### Scenario: Setting turned off while a terminal is being polled

- **WHEN** the agent-integration setting is turned off while topology polling is
  armed for a live terminal
- **THEN** that polling is cancelled
- **AND** no further process or open-file inspection runs for that terminal

#### Scenario: Idle cost while disabled

- **WHEN** the agent-integration setting is off and the window is idle
- **THEN** agent observation spawns no child processes

#### Scenario: Setting turned back on

- **WHEN** the setting is turned on again
- **THEN** observation resumes for terminals that are still alive, without
  restarting them

### Requirement: Topology sampling does not spawn per sample

Where the host can observe process topology through a long-lived stream, it
SHALL do so rather than spawning one process per sample. A repeat-mode
observation SHALL be started once for a fixed set of terminals and restarted
only when that set changes, which happens when a terminal opens or closes
rather than on every sampling interval.

A host without a streaming observation available SHALL fall back to per-sample
invocation, and the fallback SHALL remain subject to the cadence and gating
requirements above.

#### Scenario: Steady terminal set

- **WHEN** topology is sampled repeatedly while no terminal opens or closes
- **THEN** the observation process started for that terminal set is reused
- **AND** no additional process is spawned per sample

#### Scenario: Terminal set changes

- **WHEN** a terminal opens or closes
- **THEN** the observation is restarted for the new set

#### Scenario: Streaming unavailable

- **WHEN** the host cannot start a streaming observation
- **THEN** sampling falls back to per-sample invocation, still gated on the
  integration setting and still bounded in cadence
