## MODIFIED Requirements

### Requirement: The Folders tree

A project SHALL present a Folders tree in a column to the left of its panel area. The tree SHALL list the project's folders in order, each as a card. A card SHALL hold, in this order: a title line with the folder's icon, name, and menu button; a branch line when the folder has a checkout to name; a facts line when the folder has facts to show; then that folder's terminals in panel order, each with its status indicator and title; then a New terminal row. Every line and row SHALL be a single unwrapped line, and a name, branch, or title too long for the column SHALL be truncated with an ellipsis. The folder that holds the focused panel SHALL be exposed as selected, and the focused terminal's row SHALL be highlighted as active. A terminal's row SHALL offer the same context menu as that terminal's tab, acting on that terminal, whichever folder is selected. A selected folder's card SHALL NOT be outlined or striped; when the selected folder has no active terminal row, its title line SHALL be tinted so that the selection is visible. The tree SHALL offer New folder. The column's header SHALL use the project chrome so the colour band continues across the tree, the panel tab strip, and the sidebar.

#### Scenario: Reading the tree

- **WHEN** a project has General with one terminal and a linked folder with two
- **THEN** the tree shows a card for General holding its terminal, then a card for the linked folder holding its two terminals, each terminal with its status indicator, and each card ends with a New terminal row

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

- **WHEN** a user selects a folder card by its title, branch, or facts line, outside any control on them
- **THEN** that folder's layout is presented with the terminal that was last active in it focused

#### Scenario: Selected folder with an active terminal

- **WHEN** the focused terminal is in a folder
- **THEN** that terminal's row is highlighted and the folder's card has no outline, stripe, or tint of its own

#### Scenario: Selected folder with no active terminal

- **WHEN** a user selects a folder that holds no terminals
- **THEN** that folder's title line is tinted and no terminal row in the tree is highlighted

#### Scenario: Empty folder

- **WHEN** a folder holds no terminals
- **THEN** its card shows its title, branch, and facts lines followed directly by the New terminal row, with no placeholder text

#### Scenario: Long titles

- **WHEN** a terminal title or a branch name is longer than the tree is wide
- **THEN** the line stays one line and the text is truncated with an ellipsis

### Requirement: Linked folder presentation

A linked folder's card SHALL show the branch of its worktree on its branch line. General SHALL show the branch of the project root checkout in the same place. A plain folder SHALL show neither a branch line nor a facts line. A checkout is dirty when it holds changes that the default branch does not have, committed or not. The branch of a dirty checkout SHALL be drawn in the accent colour; the branch of any other checkout SHALL be drawn in the ordinary text colour.

The facts line SHALL show, in this order and each as its own chip: the checkout's change size when it is dirty, as lines added and lines removed, or the word `changed` when the size is not measured; the word `missing` when a linked folder's worktree is not on disk; nothing for a clean checkout; the pull request published for a linked folder's worktree, as `PR #` and its number, followed by its state when that state is not open; `no PR` when a linked folder is dirty and has no pull request; and the check state published for a linked folder's worktree, as an indicator, a count, and a word for what is counted. General SHALL show its change size chip and no pull request or checks chip. A folder with none of these SHALL show no facts line.

The facts line SHALL NOT wrap. Where the column is too narrow to show every chip in full, the pull request chip SHALL drop its `PR` prefix and the checks chip SHALL drop its word, each keeping its number. A chip SHALL NOT be truncated in the middle of its text. The full text of a shortened chip SHALL remain available as its accessible name and its tooltip. Choosing the pull request chip SHALL open the pull request, and choosing the checks chip SHALL show that folder's checks beneath its facts line, wherever those actions are available.

#### Scenario: Worktree with a pull request

- **WHEN** a linked folder's worktree is on `feat/one-project-one-window`, is 247 lines added and 13 removed against the default branch, and has pull request 350 with 23 checks running
- **THEN** its branch line shows that branch in the accent colour and its facts line shows `+247 −13`, `PR #350`, and a running indicator with `23 running`, on one line

#### Scenario: Worktree without a pull request

- **WHEN** a dirty linked folder's worktree has no pull request
- **THEN** its facts line shows its change size and `no PR`

#### Scenario: Clean worktree

- **WHEN** a linked folder's worktree holds nothing the default branch lacks and has no pull request
- **THEN** its branch is drawn in the ordinary text colour and its card has no facts line

#### Scenario: Clean worktree with a merged pull request

- **WHEN** a linked folder's worktree is clean and its pull request 352 is merged
- **THEN** its branch is drawn in the ordinary text colour and its facts line shows `PR #352 merged`

#### Scenario: General on a clean default branch

- **WHEN** the project root checkout is on the default branch with no changes
- **THEN** General shows that branch in the ordinary text colour and no facts line

#### Scenario: General with changes

- **WHEN** the project root checkout holds changes the default branch does not have
- **THEN** General shows its branch in the accent colour and a change size chip, and no pull request or checks chip

#### Scenario: Narrow column

- **WHEN** the column is too narrow to show `+247 −13`, `PR #350`, and `23 running` in full
- **THEN** the facts line stays one line and shows `+247 −13`, `#350`, and the running indicator with `23`

#### Scenario: Plain folder

- **WHEN** a folder is a plain folder
- **THEN** its card shows its title line and no branch or facts line

### Requirement: A terminal that creates a worktree moves into its folder

The terminal that created a worktree SHALL be the terminal of the project in whose process tree the Git command that registered the worktree ran. The server SHALL establish that from the terminal and from Git alone; it SHALL NOT depend on which agent, if any, is running in the terminal, and SHALL behave the same for an agent, a script, and a person typing the command. With the **Move terminals into new worktree folders** setting on, the server SHALL move that terminal into the worktree's folder as an ordinary folder move. A device on which that terminal was focused SHALL select the new folder and keep the terminal focused. The move SHALL be presented by the tree alone: no notice, banner, or prompt SHALL announce it. A user SHALL be able to move the terminal back by an ordinary folder move, and Terminay SHALL NOT move that terminal into that folder again on its own. When the command did not run in a terminal of the project, or the server cannot establish which terminal ran it, no terminal SHALL be moved. A worktree that already existed when the project was opened SHALL NOT cause any terminal to move.

#### Scenario: An agent creates a worktree

- **WHEN** an agent in a General terminal runs `git worktree add`
- **THEN** a linked folder for the worktree appears, that terminal is in it, the device that was looking at the terminal is still looking at it, and no notice is shown

#### Scenario: A person creates a worktree

- **WHEN** a user types `git worktree add` at the shell prompt of a General terminal
- **THEN** the same terminal is moved into the worktree's folder, with no notice

#### Scenario: Moving the terminal back

- **WHEN** the user drags that terminal's row onto General
- **THEN** the terminal is back in General, the linked folder remains with no terminals, and the terminal is not moved again

#### Scenario: Created outside the project's terminals

- **WHEN** a worktree is added from a shell that is not a terminal of the project
- **THEN** its folder appears with no terminals and no terminal moves

#### Scenario: Another terminal is sitting in the worktree

- **WHEN** one terminal creates a worktree while a second terminal's shell has changed directory into the new worktree's path
- **THEN** only the terminal that ran the command moves

## ADDED Requirements

### Requirement: Creating a terminal from a folder card

Every folder card in the Folders tree SHALL end with a New terminal row. Choosing it SHALL select that folder and create a terminal in it exactly as the project's New terminal command does while that folder is selected, and SHALL focus the new terminal. The row SHALL be present whether or not the folder already holds terminals, and SHALL come after any offer shown beneath the folder.

#### Scenario: New terminal in an empty linked folder

- **WHEN** a user chooses New terminal on a linked folder that holds no terminals
- **THEN** a terminal is created in that folder, starting in its worktree, the folder is selected, and the terminal is focused

#### Scenario: New terminal in a folder that has terminals

- **WHEN** a user chooses New terminal on a folder that holds one terminal while another folder is selected
- **THEN** the folder holds two terminals, it becomes the selected folder, and the new terminal is focused

### Requirement: Reordering folders from the tree

Every folder card other than General SHALL show a drag grip at the left of its title line. Dragging a card by its grip SHALL move it among the project's other folders, and releasing it SHALL ask the server to commit the new order; the tree SHALL present the order the server committed. The grip SHALL be reachable from the keyboard, where the up and down arrow keys SHALL move the focused folder one place. General SHALL show no grip, SHALL stay first, and no folder SHALL be placed above it. Dragging a grip SHALL NOT select a folder, start a terminal move, or open a menu.

#### Scenario: Dragging a folder up

- **WHEN** a project lists General, alpha, and beta, and a user drags beta's grip above alpha and releases
- **THEN** the tree lists General, beta, alpha, and every other device showing the project lists the same order

#### Scenario: Nothing goes above General

- **WHEN** a user drags a folder's grip above General and releases
- **THEN** the folder is placed directly beneath General

#### Scenario: Keyboard reorder

- **WHEN** beta's grip has focus and the user presses the up arrow
- **THEN** beta moves one place up, unless it is directly beneath General

#### Scenario: General has no grip

- **WHEN** the tree is shown
- **THEN** General's title line has no drag grip
