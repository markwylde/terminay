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

### Requirement: Topology sampling backs off while nothing changes

Topology sampling for a terminal that keeps finding no new evidence SHALL widen
the interval between samples up to a ceiling rather than sample at its fastest
cadence indefinitely, because each sample spawns a process. New evidence SHALL
reset the interval.

#### Scenario: Nothing changes

- **WHEN** repeated topology samples for a terminal find no change
- **THEN** the interval between samples widens up to a ceiling

#### Scenario: Evidence arrives

- **WHEN** the process topology changes for a terminal that had backed off
- **THEN** the interval resets and sampling resumes promptly
