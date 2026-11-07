## ADDED Requirements

### Requirement: Workflow progress on compact surfaces

On a compact workspace, a terminal with an attached workflow SHALL show its workflow dial — the same ring, filled to the share of steps done and coloured by the workflow's state, that its terminal tab shows — on its row in the switcher's folder tree, on its row in the Home panel's needs-you list, and in the compact title block while it is the terminal on screen. On switcher rows the dial SHALL occupy one fixed trailing column, so dials on every row of a tree line up with one another and with the folders' trailing ⋯ controls. A folder header SHALL NOT show a workflow dial. The row's second line SHALL state the workflow's current step in words. A finished workflow's dial SHALL hide on these surfaces when it hides on the terminal's tab.

#### Scenario: Dials line up

- **WHEN** a folder holds two terminals with workflows and one without
- **THEN** both dials sit in the same trailing column, the third row leaves that column empty, and the folder's header shows no dial

#### Scenario: Needs input

- **WHEN** a terminal's workflow has a step in `needs_input`
- **THEN** its switcher row shows a red dial and its second line says the workflow needs input and which step

#### Scenario: Title block

- **WHEN** a terminal whose workflow is on step three of five is on screen on a compact workspace
- **THEN** the title block shows that terminal's dial beside its project and folder
