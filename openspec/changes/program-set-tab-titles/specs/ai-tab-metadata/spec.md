## ADDED Requirements

### Requirement: A generated title is a named title

A title applied by **Set tab title with AI** SHALL be the terminal's named title: it SHALL be displayed in place of any program title, and SHALL remain until a user, another generation, or `rename_terminal` replaces or clears it. A program title change while generation is in flight SHALL NOT invalidate the target, and the generated title SHALL still be applied.

#### Scenario: Program sets a title after generation

- **WHEN** a title has been generated for a terminal and the program in it then writes a title sequence
- **THEN** the tab still shows the generated title

#### Scenario: Program title changes during generation

- **WHEN** the program in the target terminal changes its title while a title is being generated
- **THEN** the generated title is applied to that terminal

#### Scenario: Clearing a generated title

- **WHEN** a user clears the name of a tab whose title was generated
- **THEN** the tab shows its program title, or its default name when it has none
