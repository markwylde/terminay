## MODIFIED Requirements

### Requirement: The Folders tree

A project SHALL present a Folders tree in a column to the left of its panel area. The tree SHALL list the project's folders in order, each as a block that spans the full width of the column, with no side margin and no rounded corners. Consecutive blocks SHALL be separated by a narrow gutter drawn in the column's background, so that each folder reads as one group.

A block SHALL hold, in this order: a header band; that folder's panel rows; then a New terminal row. The header band SHALL be drawn in a lighter tone than the folder's rows and SHALL hold its title line, then a branch line when the folder is General and has a checkout to name, then a facts line when the folder has facts to show. The title line SHALL begin with the folder's collapse control and SHALL hold no other control before the folder's name. The title line of General and of a plain folder SHALL then hold the folder icon and the folder's name. The title line of a linked folder SHALL then hold the branch icon, the folder's label, and its unmerged mark when it has one, and a linked folder's block SHALL have no branch line. The name or label SHALL be drawn in small uppercase semibold type, in the style of the right sidebar's pane titles, while its accessible name and tooltip keep the text's own case. The title line SHALL end with a pill counting the panels the folder holds, then the folder's menu button.

The branch line and the facts line SHALL start at the leading edge of the header band's content, under the collapse control, with no further indent. Each panel row SHALL be set in so that its status indicator, or the icon that stands in its place, sits under the collapse control.

Every line and row SHALL be a single unwrapped line, and a name, label, branch, or title too long for the column SHALL be truncated with an ellipsis. The folder that holds the focused panel SHALL be exposed as selected, and the focused panel's row SHALL be highlighted as active. A terminal's row SHALL offer the same context menu as that terminal's tab, acting on that terminal, whichever folder is selected. The selected folder's header band SHALL be tinted with the project colour, and its block SHALL NOT be outlined or striped. The tree SHALL offer New folder. The column's header SHALL use the project chrome so the colour band continues across the tree, the panel tab strip, and the sidebar.

#### Scenario: Reading the tree

- **WHEN** a project has General with one terminal and a linked folder with two
- **THEN** the tree shows a block for General with its header band, its terminal, and a New terminal row, then a gutter, then a block for the linked folder with its header band, its two terminals, and a New terminal row

#### Scenario: Blocks span the column

- **WHEN** the tree shows two folders
- **THEN** each folder's block reaches both edges of the column, has square corners, and is separated from the next by a gutter in the column's background

#### Scenario: Lines of a linked folder's block

- **WHEN** a linked folder's worktree is on `feat/reorder-rows` and is dirty with no pull request
- **THEN** its header band shows one title line holding the collapse control, the branch icon, `FEAT/REORDER-ROWS`, a panel count, and the menu button, then its facts line, with no folder icon and no second line naming the branch
- **AND** the label's accessible name is `feat/reorder-rows`

#### Scenario: Lines of General's block

- **WHEN** the project root checkout is on `main`
- **THEN** General's header band shows a title line holding the collapse control, the folder icon, `GENERAL`, a panel count, and the menu button, then a branch line showing `main`

#### Scenario: Panel count

- **WHEN** a folder holds two terminals and one open file
- **THEN** its title line's count pill shows `3`

#### Scenario: Lines start under the chevron

- **WHEN** a linked folder shows a facts line and holds a terminal
- **THEN** the facts line's first chip starts at the same horizontal position as the collapse control, and the terminal's status indicator sits under the collapse control

#### Scenario: Selecting a terminal

- **WHEN** a user selects a terminal row in another folder
- **THEN** that folder becomes the selected folder, its layout is presented, that terminal is focused, and its row is the one highlighted

#### Scenario: A terminal row's menu

- **WHEN** a user opens the context menu on a terminal's row
- **THEN** it offers what the context menu of that terminal's tab offers, and choosing Close closes that terminal

#### Scenario: A terminal row's menu in another folder

- **WHEN** a user opens the context menu on the row of a terminal in a folder that is not the selected one
- **THEN** the menu is that terminal's, and acts on it

#### Scenario: Selecting a folder

- **WHEN** a user selects a folder by its title, branch, or facts line, outside any control on them
- **THEN** that folder's layout is presented with the panel that was last active in it focused

#### Scenario: The selected folder

- **WHEN** the focused terminal is in a folder
- **THEN** that terminal's row is highlighted, that folder's header band is tinted, and no other header band is tinted

#### Scenario: Selected folder with no panels

- **WHEN** a user selects a folder that holds no panels
- **THEN** that folder's header band is tinted and no row in the tree is highlighted

#### Scenario: Empty folder

- **WHEN** a folder holds no panels
- **THEN** its block shows its header band followed directly by the New terminal row, with no placeholder text

#### Scenario: Long titles

- **WHEN** a terminal title, a branch name, or a linked folder's label is longer than the tree is wide
- **THEN** the line stays one line and the text is truncated with an ellipsis

### Requirement: Creating a terminal from a folder card

Every open folder's block in the Folders tree SHALL end with a New terminal row. Choosing the row's label SHALL select that folder and create a terminal in it exactly as the project's New terminal command does while that folder is selected, and SHALL focus the new terminal. The row SHALL be present whether or not the folder already holds panels, and SHALL come after any offer shown beneath the folder.

While the pointer is over the row, or focus is within it, the row SHALL show at its trailing end one launcher button for the default shell followed by one launcher button for each available terminal launcher, in the order the server lists them. Where the device has no hover, the launcher buttons SHALL be shown at all times. Each launcher button SHALL show its launcher's icon, SHALL have the launcher's name as its accessible name, and SHALL show a tooltip naming what it starts. Choosing the default shell's button SHALL do what choosing the label does. Choosing a launcher's button SHALL select that folder and create a terminal in it that starts the launcher's agent, and SHALL focus the new terminal. A launcher that becomes unavailable SHALL disappear from every row without a reload, and one that becomes available SHALL appear. A tree that only lists, such as a tab peek, SHALL show no New terminal row.

#### Scenario: New terminal in an empty linked folder

- **WHEN** a user chooses the New terminal label on a linked folder that holds no panels
- **THEN** a terminal is created in that folder, starting in its worktree, the folder is selected, and the terminal is focused

#### Scenario: New terminal in a folder that has terminals

- **WHEN** a user chooses the New terminal label on a folder that holds one terminal while another folder is selected
- **THEN** the folder holds two terminals, it becomes the selected folder, and the new terminal is focused

#### Scenario: Hovering the row

- **WHEN** Claude Code and Codex launchers are available and a user moves the pointer over a folder's New terminal row
- **THEN** the row shows three launcher buttons at its end: the default shell, Claude Code, and Codex

#### Scenario: Not hovering

- **WHEN** the pointer is not over a New terminal row and focus is not within it, on a device with hover
- **THEN** the row shows its label and no launcher buttons

#### Scenario: Launching an agent

- **WHEN** a user chooses the Claude Code button on a linked folder's New terminal row
- **THEN** a terminal is created in that folder, starting in its worktree, Claude Code starts in it, the folder is selected, and the terminal is focused

#### Scenario: Tooltip

- **WHEN** a user rests the pointer on the Codex button
- **THEN** a tooltip says it starts a new Codex terminal

#### Scenario: Keyboard

- **WHEN** a user moves focus with Tab into a New terminal row
- **THEN** the launcher buttons are shown and each can be reached and chosen from the keyboard

#### Scenario: Harness switched off

- **WHEN** a user switches off the Codex harness in Settings while the tree is shown
- **THEN** the Codex button no longer appears on any New terminal row

#### Scenario: No agents available

- **WHEN** no terminal launcher is available
- **THEN** hovering the New terminal row shows only the default shell's button
