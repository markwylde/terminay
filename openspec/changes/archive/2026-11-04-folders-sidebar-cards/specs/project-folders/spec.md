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

### Requirement: Linked folder presentation

A linked folder SHALL be named by its label. The label SHALL be the branch of its worktree. When the worktree has no branch, as on a detached HEAD, or its branch is not known, the label SHALL be the name of the worktree's directory. When the worktree's branch is also the branch of another checkout of the same repository, the project root checkout included, the label SHALL be the branch followed by the name of the worktree's directory, the directory name drawn in a muted colour. The label SHALL follow the worktree: when the worktree changes branch, the card shows the new branch without the folder moving or losing its terminals. Wherever the workspace names a folder outside the tree, including the compact switcher, a menu that moves a terminal to a folder, the Files pane heading, and the accessible names of a card's controls, a linked folder SHALL be named by its label.

A linked folder's title line is its checkout line. General SHALL show the branch of the project root checkout on a branch line beneath its title, and that branch line is its checkout line. A plain folder SHALL show neither a branch line nor a facts line.

A checkout is dirty when it holds work that exists only on this machine: uncommitted or untracked changes, or unpushed commits. A checkout is unmerged when it holds commits whose effect the default branch does not have, whether or not they are pushed. The two are independent. On the checkout line, the branch or label of a dirty checkout SHALL be drawn in the accent colour; that of any other checkout SHALL be drawn in the ordinary text colour. The branch or label of an unmerged checkout SHALL be followed on its checkout line by an upward arrow and the number of commits the default branch lacks, or the arrow alone when that number is not measured. The arrow and number SHALL keep a muted colour whether or not the checkout is dirty, SHALL NOT be truncated when the branch or label is, and SHALL give their meaning as an accessible name and a tooltip. A checkout that is not unmerged SHALL show no arrow.

The facts line SHALL show, in this order and each as its own chip: the size of the checkout's unpushed work when it is dirty, as lines added and lines removed, or the word `changed` when the size is not measured; the word `missing` when a linked folder's worktree is not on disk; nothing for a checkout that is not dirty; the pull request published for a linked folder's worktree, as `PR #` and its number, followed by its state when that state is not open; `no PR` when a linked folder is dirty or unmerged and has no pull request; and the check state published for a linked folder's worktree, as an indicator, a count, and a word for what is counted. General SHALL show its change size chip and no pull request or checks chip. A folder with none of these SHALL show no facts line.

The facts line SHALL NOT wrap. Where the column is too narrow to show every chip in full, the pull request chip SHALL drop its `PR` prefix and the checks chip SHALL drop its word, each keeping its number. A chip SHALL NOT be truncated in the middle of its text. The full text of a shortened chip SHALL remain available as its accessible name and its tooltip. Choosing the pull request chip SHALL open the pull request, and choosing the checks chip SHALL show that folder's checks beneath its facts line, wherever those actions are available.

#### Scenario: Worktree named by its branch

- **WHEN** a worktree in the directory `folders-sidebar-reorder-all-rows` is on the branch `worktree-folders-sidebar-reorder-all-rows`
- **THEN** its card's title line shows `worktree-folders-sidebar-reorder-all-rows`, and `folders-sidebar-reorder-all-rows` is not shown on the card

#### Scenario: Detached worktree

- **WHEN** a worktree in the directory `bisect-crash` is on a detached HEAD
- **THEN** its card's title line shows the branch icon and `bisect-crash`

#### Scenario: Two checkouts on one branch

- **WHEN** a worktree in the directory `hotfix-copy` has been forced onto `main` while the project root checkout is also on `main`
- **THEN** the worktree's title line shows `main` followed by `hotfix-copy` in a muted colour, and General still shows its title with `main` beneath

#### Scenario: Worktree changes branch

- **WHEN** a terminal in a linked folder switches its worktree from `feat/a` to `feat/b`
- **THEN** the same card, in the same place with the same terminals, shows `feat/b`

#### Scenario: Linked folder named outside the tree

- **WHEN** a project with a linked folder whose worktree is on `feat/reorder-rows` is shown at phone width
- **THEN** the switcher lists that folder as `feat/reorder-rows`

#### Scenario: Pushed branch with a pull request

- **WHEN** a linked folder's worktree is on `feat/one-project-one-window`, every one of its four commits is pushed, nothing is uncommitted, the default branch lacks those commits, and it has pull request 350 with 23 checks running
- **THEN** its title line shows that branch in the ordinary text colour followed by `↑4`, and its facts line shows `PR #350` and a running indicator with `23 running`, with no change size chip

#### Scenario: Unpushed work on a branch with a pull request

- **WHEN** that worktree then gains uncommitted and unpushed work of 12 lines added and 3 removed, of which one commit is unpushed
- **THEN** its title line shows the branch in the accent colour followed by `↑5`, and its facts line shows `+12 −3`, `PR #350`, and the running indicator with `23 running`, on one line

#### Scenario: Worktree without a pull request

- **WHEN** a dirty linked folder's worktree has no pull request
- **THEN** its facts line shows the size of its unpushed work and `no PR`

#### Scenario: Pushed branch without a pull request

- **WHEN** a linked folder's worktree is unmerged, has nothing unpushed, and has no pull request
- **THEN** its label is drawn in the ordinary text colour with its arrow and number, and its facts line shows `no PR` and no change size chip

#### Scenario: Uncommitted work on a merged branch

- **WHEN** a linked folder's worktree holds uncommitted changes and no commit the default branch lacks
- **THEN** its label is drawn in the accent colour with no arrow, and its facts line shows the size of the uncommitted changes

#### Scenario: Clean worktree

- **WHEN** a linked folder's worktree holds nothing the default branch lacks, nothing unpushed, and has no pull request
- **THEN** its label is drawn in the ordinary text colour with no arrow and its card has no facts line

#### Scenario: Clean worktree with a merged pull request

- **WHEN** a linked folder's worktree is neither dirty nor unmerged and its pull request 352 is merged
- **THEN** its label is drawn in the ordinary text colour and its facts line shows `PR #352 merged`

#### Scenario: General on a clean default branch

- **WHEN** the project root checkout is on the default branch with no changes and nothing unpushed
- **THEN** General shows that branch in the ordinary text colour and no facts line

#### Scenario: General with changes

- **WHEN** the project root checkout holds uncommitted changes or unpushed commits
- **THEN** General shows its branch in the accent colour and a change size chip, and no pull request or checks chip

#### Scenario: Long branch name on an unmerged checkout

- **WHEN** an unmerged checkout's branch name is longer than the column is wide
- **THEN** the branch name is truncated with an ellipsis and the arrow and number are shown in full after it

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

### Requirement: Reordering folders from the tree

Every folder card, General included, SHALL be reorderable to any place in the project’s folder order by carrying its title line under the Carrying a folder by its title requirement. Releasing a carried card SHALL ask the server to commit the new order; the tree SHALL present the order the server committed. Reordering SHALL NOT select a folder, start a terminal move, or open a menu. A tree that only lists, such as a tab peek, SHALL offer no reordering.

While a card is dragged it SHALL be drawn lifted above the other cards and SHALL follow the pointer along the vertical axis only, never moving sideways. The other cards SHALL slide to open the place the dragged card would take if released, and on release the card SHALL settle into that place. Where the device asks for reduced motion, the cards SHALL take their new places without animation.

#### Scenario: Dragging a folder up

- **WHEN** a project lists General, alpha, and beta, and a user drags beta's title above alpha and releases
- **THEN** the tree lists General, beta, alpha, and every other device showing the project lists the same order

#### Scenario: Dragging a folder above General

- **WHEN** a project lists General, alpha, and beta, and a user drags beta's title above General and releases
- **THEN** the tree lists beta, General, alpha, and every other device showing the project lists the same order

#### Scenario: Dragging General

- **WHEN** a project lists General, alpha, and beta, and a user drags General's title below beta and releases
- **THEN** the tree lists alpha, beta, General, and a reload shows the same order

#### Scenario: Keyboard reorder

- **WHEN** beta is last of three folders, its title row has focus, and the user presses Alt with the up arrow twice and then once more
- **THEN** beta is first after the second press, the third press changes nothing, and the title row keeps focus throughout

#### Scenario: The card follows the pointer vertically

- **WHEN** a user presses a card's title and moves the pointer down and to the right
- **THEN** the card moves down with the pointer, its horizontal position does not change, and the card it passes slides up into the place it left

#### Scenario: Reduced motion

- **WHEN** the device asks for reduced motion and a user drags a card to a new place and releases
- **THEN** the cards are in the new order with no sliding or settling animation
