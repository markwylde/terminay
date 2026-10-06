## MODIFIED Requirements

### Requirement: Session-owned bounded foreground observation

Foreground-process observation SHALL be exact-session, bounded derived state. Each session SHALL own its observation work with at most one sample executing and one latest requested sample pending. Continued output SHALL replace obsolete pending work and SHALL NOT require a terminal to become silent before the current state can settle. A slow, unavailable, or capability-limited observation SHALL be an explicit limited state for that session and SHALL NOT delay activity, commands, workspace mutations, or close protection for another session. Activity snapshots SHALL return the latest committed projection and SHALL NOT wait for live host observation.

Output SHALL be evidence that the foreground may have changed, and SHALL NOT be a unit of observation work. Output that follows a quiet period SHALL refresh the session's foreground projection without waiting for a timer. While output continues, output-driven host samples for a session SHALL be spaced by the shared damping ramp that fronts all change-driven work: no sooner than 1 s after the previous one, widening while output continues and returning to its floor after a quiet period, however many output events arrive and however quickly a sample completes. Output that arrives inside a ramp interval SHALL collapse into exactly one further sample when that interval ends, whether or not more output follows. This pacing SHALL NOT apply to a fresh observation requested for destructive close protection.

#### Scenario: Continuously outputting terminal

- **WHEN** a terminal produces continuous output
- **THEN** obsolete pending observation work is replaced and the current state settles without requiring silence

#### Scenario: Slow observation on one session

- **WHEN** foreground observation is slow or unavailable for one session
- **THEN** it becomes an explicit limited state for that session and does not delay another session's activity, commands, workspace mutations, or close protection

#### Scenario: Snapshot read

- **WHEN** a client reads an activity snapshot
- **THEN** it receives the latest committed projection without waiting for live host observation

#### Scenario: Output after a quiet period

- **WHEN** a terminal that has been quiet for at least the current ramp interval produces output
- **THEN** a host sample for that session begins at once, without waiting for a timer

#### Scenario: Repainting terminal

- **WHEN** a terminal produces hundreds of output events a second and each host sample completes immediately
- **THEN** the session begins one output-driven host sample at once and no more than one per ramp interval after it

#### Scenario: Output stops inside a ramp interval

- **WHEN** a terminal's last output arrives inside the ramp interval that followed its most recent output-driven host sample
- **THEN** exactly one further host sample begins when that interval ends, and the settled projection reflects the state after the last output

#### Scenario: Close requested while output is being paced

- **WHEN** destructive close protection requests a fresh observation for a session whose output-driven sampling is inside a ramp interval
- **THEN** the fresh sample begins immediately and is not delayed by the ramp
