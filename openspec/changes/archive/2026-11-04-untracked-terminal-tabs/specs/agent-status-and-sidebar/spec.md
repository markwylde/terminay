## MODIFIED Requirements

### Requirement: Terminal tab and header status surfaces

Bound roots of a tracked terminal SHALL render the canonical RAG glyph on terminal tabs for `working` always, and for `waiting`, `blocked`, and `done` only while those entries are unacknowledged. The header SHALL aggregate unacknowledged meaningful entries from every attached connection, excluding entries bound to an untracked terminal as specified by `terminal-activity-signals`, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation. Every aggregated entry SHALL stay keyed by its server and project, and activating one SHALL act on that entry's own server.

#### Scenario: Bound root on a tab

- **WHEN** a terminal has a bound agent root that is working
- **THEN** its tab renders the canonical RAG glyph for working

#### Scenario: Unacknowledged done on a tab

- **WHEN** a background terminal has a bound agent root that is `done` and unacknowledged
- **THEN** its tab renders the green RAG glyph

#### Scenario: Acknowledged done on a tab

- **WHEN** a terminal has a bound agent root that is `done` and acknowledged
- **THEN** its tab does not render a done RAG glyph

#### Scenario: Aggregating in the header

- **WHEN** several unacknowledged entries exist
- **THEN** waiting and blocked entries take priority in the header aggregate and done entries remain until acknowledged

#### Scenario: Entries from two attached servers

- **WHEN** two attached servers each hold an unacknowledged waiting entry
- **THEN** the header aggregate includes both, each row keyed by its server and project, and activating one acts only on that server

#### Scenario: Bound root in an untracked terminal

- **WHEN** a terminal whose **Track activity** is off has a bound agent root that is working, waiting, blocked, or unacknowledged done
- **THEN** its tab renders no RAG glyph and the header aggregate does not include that entry
