## MODIFIED Requirements

### Requirement: Acknowledgement independent of state

Acknowledgement SHALL be independent of operational state, with one exception: acknowledging a `done` root SHALL return it to `idle`, because `done` exists only to mark a result the user has not yet seen. Interacting with a terminal — clicking its tab, clicking into it, or typing — SHALL clear its unread treatment, SHALL return each of its bound `done` roots to `idle`, and SHALL leave every other provider-derived state unchanged. A subagent's `done` SHALL NOT change on acknowledgement. A later meaningful transition SHALL be able to make an entry unread again. Activating the project SHALL NOT clear unread treatment. A meaningful `done`, `waiting`, or `blocked` transition SHALL remain unread until the user interacts with that terminal after the transition, even when the terminal already has focus. Passive focus and pointer movement SHALL NOT count as interaction. A terminal navigation command that deliberately focuses the terminal SHALL count as interaction.

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
- **THEN** the entry remains unread and `done` until the next interaction, and enabled green tab and project activity indicators are shown for it

#### Scenario: Waiting while already viewing

- **WHEN** a bound agent becomes `waiting` or `blocked` on the terminal the user is already clicking or typing in
- **THEN** the entry remains unread with its operational state unchanged until the next interaction, and enabled red tab and project activity indicators are shown for it

#### Scenario: Subagent done is kept

- **WHEN** the user acknowledges a terminal whose bound root has a subagent in `done`
- **THEN** the subagent stays `done`
