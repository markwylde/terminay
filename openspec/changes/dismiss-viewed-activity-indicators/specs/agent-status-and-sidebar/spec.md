## MODIFIED Requirements

### Requirement: Canonical agent states

An agent entry SHALL carry one of five states. `working` means the agent is processing a turn or performing tool or subagent work and SHALL be indicated in yellow or amber with restrained motion, including on the focused terminal. `waiting` means the provider explicitly requests approval, an answer, or other user input and SHALL be indicated in red while unacknowledged. `blocked` means a supported record explicitly reports a blocking condition and SHALL be indicated in red with an accessible label distinct from waiting while unacknowledged. `done` means the current turn or agent run completed, failed, or was cancelled and SHALL be indicated in green while unacknowledged. `idle` means the live session exists without active work or a pending result and SHALL be neutral or hidden on compact surfaces. Viewing the bound terminal SHALL hide the waiting, blocked, and done tab indicators without rewriting those states. The Agents pane SHALL continue to present operational state independently of acknowledgement.

#### Scenario: Approval requested

- **WHEN** a provider record explicitly requests approval or user input
- **THEN** the entry is `waiting` and is indicated in red

#### Scenario: Blocking condition

- **WHEN** a supported record explicitly reports a blocking condition
- **THEN** the entry is `blocked` and carries an accessible label distinct from waiting

#### Scenario: Turn completes

- **WHEN** a turn completes, fails, or is cancelled
- **THEN** the entry is `done` and is indicated in green while unacknowledged

#### Scenario: Viewing a done agent

- **WHEN** the user views a terminal whose bound agent is `done`
- **THEN** the tab's green indicator is hidden and the entry remains `done`

### Requirement: Acknowledgement independent of state

Acknowledgement SHALL be independent of operational state. Viewing an entry SHALL clear its unread treatment without rewriting its provider-derived state, and a later meaningful transition SHALL be able to make it unread again. A terminal that is already focused when a meaningful `done`, `waiting`, or `blocked` transition arrives SHALL be treated as viewed for that transition.

#### Scenario: Viewing an entry

- **WHEN** the user views an agent entry
- **THEN** its unread treatment clears and its provider-derived state is unchanged

#### Scenario: New transition after acknowledgement

- **WHEN** a meaningful transition occurs after an entry was acknowledged
- **THEN** the entry becomes unread again

#### Scenario: Done while already viewing

- **WHEN** a bound agent becomes `done` on the terminal the user is already viewing
- **THEN** the entry is acknowledged, remains `done`, and no green tab or project activity indicator is shown for it

#### Scenario: Waiting while already viewing

- **WHEN** a bound agent becomes `waiting` or `blocked` on the terminal the user is already viewing
- **THEN** the entry is acknowledged, its operational state is unchanged, and no red tab or project activity indicator is shown for it

### Requirement: Terminal tab and header status surfaces

Bound roots SHALL render the canonical RAG glyph on terminal tabs for `working` always, and for `waiting`, `blocked`, and `done` only while those entries are unacknowledged. The header SHALL aggregate unacknowledged meaningful entries, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation.

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
