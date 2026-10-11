## MODIFIED Requirements

### Requirement: Acknowledgement independent of state

Acknowledgement SHALL be independent of operational state. Interacting with a terminal — clicking its tab, clicking into it, typing, or moving focus to it with a terminal navigation command — SHALL clear its unread treatment without rewriting its provider-derived state, and a later meaningful transition SHALL be able to make it unread again. Activating the project SHALL NOT clear unread treatment. Where the user is when a meaningful `done`, `waiting`, or `blocked` transition arrives SHALL NOT acknowledge it: a transition on the focused terminal, including one the user has just typed in, SHALL be unread until the user interacts with that terminal. Focus that lands in the terminal on its own, and mouse movement over it, SHALL NOT count as interacting.

#### Scenario: Viewing an entry

- **WHEN** the user clicks the bound terminal tab, clicks into that terminal, or types into it
- **THEN** its unread treatment clears and its provider-derived state is unchanged

#### Scenario: Activating the project does not acknowledge an agent

- **WHEN** a bound agent is `done` or needs attention and the user activates its project without interacting with that terminal
- **THEN** the entry stays unread and the tab indicator remains

#### Scenario: New transition after acknowledgement

- **WHEN** a meaningful transition occurs after an entry was acknowledged
- **THEN** the entry becomes unread again

#### Scenario: Done while already viewing

- **WHEN** a bound agent becomes `done` on the focused terminal the user last typed in, and the user does nothing further in it
- **THEN** the entry is unread, remains `done`, and the green tab and project activity indicators are shown for it

#### Scenario: Waiting while already viewing

- **WHEN** a bound agent becomes `waiting` or `blocked` on the focused terminal the user last typed in, and the user does nothing further in it
- **THEN** the entry is unread, its operational state is unchanged, and the red tab and project activity indicators are shown for it
