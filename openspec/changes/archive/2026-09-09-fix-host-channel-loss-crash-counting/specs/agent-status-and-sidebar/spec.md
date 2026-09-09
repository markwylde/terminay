## MODIFIED Requirements

### Requirement: Discovery windows and retries

Every transition away from the shell SHALL start a new bounded journal-discovery window even when the foreground name is not a recognized provider, so a resumed session launched long after terminal startup can bind its reopened journal without treating the wrapper as an agent. Discovery SHALL be retried briefly after terminal startup and whenever the shell loses foreground. A blank or unknown process name SHALL NOT be a leave-shell edge and SHALL NOT start discovery. A provider that reports `not-bound`, or whose observation throws before a journal is proven, SHALL be retried at most ten times at a 100 ms debounce while that exact foreground incarnation remains current. After that fast window, topology polling SHALL keep discovery armed until the incarnation is bound or returns to the shell, and SHALL re-admit on the first sample after the fast window rather than only when a later signature changes.

A terminal that stays unbound across repeated windows SHALL re-arm on a widening interval up to a ceiling, rather than at its fastest cadence indefinitely. New evidence — a changed process topology, a foreground change, or a return to the shell — SHALL reset that interval, so a journal that appears late is still admitted promptly while a terminal that will never bind stops sweeping every installed provider. An empty process snapshot SHALL be treated as ordinary transient evidence rather than a reason to give up.

#### Scenario: Not-bound provider

- **WHEN** a provider reports `not-bound` for the current foreground incarnation
- **THEN** discovery retries at most ten times at a 100 ms debounce while that incarnation remains current

#### Scenario: Journal appears after the fast window

- **WHEN** a provider opens its writable journal only after the fast discovery window ends
- **THEN** topology polling re-admits it on the first sample after that window

#### Scenario: Terminal that never binds

- **WHEN** a terminal remains unbound across repeated discovery windows with no new evidence
- **THEN** the interval between re-arming attempts widens up to a ceiling instead of repeating at its fastest cadence

#### Scenario: Evidence arrives after backing off

- **WHEN** the process topology changes, the foreground changes, or the shell returns for a terminal that had backed off
- **THEN** the interval resets and discovery is armed again promptly

#### Scenario: Blank foreground name

- **WHEN** the foreground process name is blank or unknown
- **THEN** no leave-shell discovery window starts

#### Scenario: Empty process snapshot

- **WHEN** a process snapshot returns empty
- **THEN** it is treated as transient evidence and discovery continues
