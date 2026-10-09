## ADDED Requirements

### Requirement: Terminal names over MCP

`rename_terminal` SHALL set the terminal's named title, which is displayed in place of any program title. `list_terminals` SHALL report each terminal's displayed title as its display name, whether that is a named title, a program title, or a default name. A display name SHALL NOT identify a terminal to any tool; tools SHALL address terminals by opaque handle only.

#### Scenario: Renaming over a program title

- **WHEN** an agent calls `rename_terminal` on a terminal showing a program title
- **THEN** the tab shows the name the agent gave, and later program title sequences do not change it

#### Scenario: Listing a terminal with a program title

- **WHEN** an agent calls `list_terminals` and a terminal in scope has a program title and no named title
- **THEN** that terminal's display name is the program title

#### Scenario: Program title matching another terminal's name

- **WHEN** a program sets its title to another terminal's display name and an agent addresses a terminal by handle
- **THEN** the tool acts on the terminal the handle names
