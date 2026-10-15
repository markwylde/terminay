## MODIFIED Requirements

### Requirement: Canonical agent states

An agent entry SHALL carry one of five states. `working` means the agent is processing a turn or performing tool or subagent work and SHALL be indicated in yellow or amber with restrained motion, including on the focused terminal. `waiting` means the provider explicitly requests approval, an answer, or other user input and SHALL be indicated in red while unacknowledged. `blocked` means a supported record explicitly reports a blocking condition and SHALL be indicated in red with an accessible label distinct from waiting while unacknowledged. `done` means the current turn or agent run completed, failed, or was cancelled and the user has not yet acknowledged the result, and SHALL be indicated in green. `idle` means the live session exists without active work or a pending result and SHALL be neutral or hidden on compact surfaces. Viewing the bound terminal SHALL hide the waiting and blocked tab indicators without rewriting those states, and SHALL return a `done` root to `idle`. The Agents pane SHALL present operational state, so an acknowledged root that was `done` SHALL appear there as `idle`.

#### Scenario: Approval requested

- **WHEN** a provider record explicitly requests approval or user input
- **THEN** the entry is `waiting` and is indicated in red

#### Scenario: Blocking condition

- **WHEN** a supported record explicitly reports a blocking condition
- **THEN** the entry is `blocked` and carries an accessible label distinct from waiting

#### Scenario: Turn completes

- **WHEN** a turn completes, fails, or is cancelled
- **THEN** the entry is `done` and is indicated in green

#### Scenario: Viewing a done agent

- **WHEN** the user views a terminal whose bound root agent is `done`
- **THEN** the root becomes `idle`, and no surface — tab, project, header, Agents pane, dashboard, or home overview — shows it as done

### Requirement: Acknowledgement independent of state

Acknowledgement SHALL be independent of operational state, with one exception: acknowledging a `done` root SHALL return it to `idle`, because `done` exists only to mark a result the user has not yet seen. Interacting with a terminal — clicking its tab, clicking into it, or typing — SHALL clear its unread treatment, SHALL return each of its bound `done` roots to `idle`, and SHALL leave every other provider-derived state unchanged. A subagent's `done` SHALL NOT change on acknowledgement. A later meaningful transition SHALL be able to make an entry unread again. Activating the project SHALL NOT clear unread treatment. A terminal the user is already interacting with when a meaningful `done`, `waiting`, or `blocked` transition arrives SHALL be treated as viewed for that transition.

#### Scenario: Viewing an entry

- **WHEN** the user clicks the bound terminal tab, clicks into that terminal, or types into it
- **THEN** its unread treatment clears, a `done` root becomes `idle`, and any other provider-derived state is unchanged

#### Scenario: Activating the project does not acknowledge an agent

- **WHEN** a bound agent is `done` or needs attention and the user activates its project without interacting with that terminal
- **THEN** the entry stays unread, keeps its state, and the tab indicator remains

#### Scenario: New transition after acknowledgement

- **WHEN** a meaningful transition occurs after an entry was acknowledged
- **THEN** the entry becomes unread again

#### Scenario: Next turn after a done root was viewed

- **WHEN** a root that was returned to `idle` by acknowledgement starts and completes another turn
- **THEN** it becomes `done` and unread again

#### Scenario: Snapshot after acknowledgement

- **WHEN** a session source reports an `idle` snapshot whose last turn ended before the root was acknowledged
- **THEN** the root stays `idle`

#### Scenario: Done while already viewing

- **WHEN** a bound agent becomes `done` on the terminal the user is already clicking or typing in
- **THEN** the entry is acknowledged, becomes `idle`, and no green tab or project activity indicator is shown for it

#### Scenario: Waiting while already viewing

- **WHEN** a bound agent becomes `waiting` or `blocked` on the terminal the user is already clicking or typing in
- **THEN** the entry is acknowledged, its operational state is unchanged, and no red tab or project activity indicator is shown for it

#### Scenario: Subagent done is kept

- **WHEN** the user acknowledges a terminal whose bound root has a subagent in `done`
- **THEN** the subagent stays `done`

### Requirement: Row activation

Activating a bound row SHALL activate its exact project and terminal panel, focus the terminal, and acknowledge that entry, which returns a `done` root to `idle` and leaves any other state unchanged. Activating an external row SHALL do nothing. No approximate terminal SHALL be focused when a row has no binding.

#### Scenario: Activating a bound row

- **WHEN** the user activates an agent row bound to a terminal
- **THEN** its exact project and terminal panel activate, the terminal is focused, and the entry is acknowledged, becoming `idle` if it was a `done` root and otherwise keeping its state

#### Scenario: Binding unavailable

- **WHEN** the user activates a row that is not bound to a terminal
- **THEN** no terminal is focused

### Requirement: Terminal tab and header status surfaces

Bound roots SHALL render the canonical RAG glyph on terminal tabs for `working`, and for `waiting`, `blocked`, and `done` only while those entries are unacknowledged, each subject to the same tab-indicator settings that govern a plain terminal's indicators. The header SHALL aggregate unacknowledged meaningful entries from every attached connection that those settings leave visible, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation. Every aggregated entry SHALL stay keyed by its server and project, and activating one SHALL act on that entry's own server.

#### Scenario: Bound root on a tab

- **WHEN** a terminal has a bound agent root that is working and active-tab indicators are on
- **THEN** its tab renders the canonical RAG glyph for working

#### Scenario: Unacknowledged done on a tab

- **WHEN** a background terminal has a bound agent root that is `done` and unacknowledged, and finished-tab indicators are on
- **THEN** its tab renders the green RAG glyph

#### Scenario: Acknowledged done on a tab

- **WHEN** the user acknowledges a terminal whose bound agent root is `done`
- **THEN** the root becomes `idle` and its tab does not render a RAG glyph

#### Scenario: Aggregating in the header

- **WHEN** several unacknowledged entries exist
- **THEN** waiting and blocked entries take priority in the header aggregate and done entries remain until acknowledged

#### Scenario: Entries from two attached servers

- **WHEN** two attached servers each hold an unacknowledged waiting entry
- **THEN** the header aggregate includes both, each row keyed by its server and project, and activating one acts only on that server
