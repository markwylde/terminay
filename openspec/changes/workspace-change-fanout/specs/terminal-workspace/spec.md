## ADDED Requirements

### Requirement: A terminal's tab shows the live title fact

A terminal's tab, its sidebar row, and every list that names the terminal SHALL show the displayed title the server publishes for it as a live terminal title fact. When that title changes, only the elements that show that terminal's title SHALL be rendered again. Until a title fact has arrived for a terminal, its tab SHALL show the title held in workspace state.

#### Scenario: Title changes on one of several terminals

- **WHEN** one terminal's displayed title changes while several terminals are open
- **THEN** that terminal's tab and the rows that name it show the new title, and no other terminal's tab or panel is rendered again

#### Scenario: Typing while another terminal's title animates

- **WHEN** a person types in one terminal while a program in another rewrites its title once a second
- **THEN** the terminal being typed in is not rendered again by the title changes

#### Scenario: Server that publishes no title facts

- **WHEN** a client is connected to a server that publishes no live title facts
- **THEN** each terminal's tab shows the title held in workspace state

### Requirement: Terminal panel parameters change only when their values do

A client SHALL hand a terminal panel a new presentation parameter only when its value differs from the one the panel holds. Reconciling panels against a workspace projection in which a terminal is unchanged SHALL leave that terminal's panel and tab unrendered.

#### Scenario: Reconciliation with nothing changed for a terminal

- **WHEN** panels are reconciled against a projection in which a terminal's title, note, emoji, colour, and activity setting are unchanged
- **THEN** that terminal's panel and tab are not rendered again
