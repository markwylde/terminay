## MODIFIED Requirements

### Requirement: The Folders tree

A project SHALL present a Folders tree in a column to the left of its panel area. The tree SHALL list the project's folders in order, each as a card. A card SHALL hold, in this order: a title line; a branch line when the folder is General and has a checkout to name; a facts line when the folder has facts to show; then that folder's terminals in panel order, each with its status indicator and title; then a New terminal row. The title line of General and of a plain folder SHALL hold the folder icon, the folder's name, and its menu button. The title line of a linked folder SHALL hold the branch icon, the folder's label, its unmerged mark when it has one, and its menu button, and a linked folder's card SHALL have no branch line. Every line and row SHALL be a single unwrapped line, and a name, label, branch, or title too long for the column SHALL be truncated with an ellipsis. The folder that holds the focused panel SHALL be exposed as selected, and the focused terminal's row SHALL be highlighted as active. A terminal's row SHALL offer the same context menu as that terminal's tab, acting on that terminal, whichever folder is selected. A selected folder's card SHALL NOT be outlined or striped; when the selected folder has no active terminal row, its title line SHALL be tinted so that the selection is visible. The tree SHALL offer New folder. The column's header SHALL use the project chrome so the colour band continues across the tree, the panel tab strip, and the sidebar.

#### Scenario: Reading the tree

- **WHEN** a project has General with one terminal and a linked folder with two
- **THEN** the tree shows a card for General holding its terminal, then a card for the linked folder holding its two terminals, each terminal with its status indicator, and each card ends with a New terminal row

#### Scenario: Lines of a linked folder's card

- **WHEN** a linked folder's worktree is on `feat/reorder-rows` and is dirty with no pull request
- **THEN** its card shows one title line holding the branch icon, `feat/reorder-rows`, and the menu button, then its facts line, with no folder icon and no second line naming the branch

#### Scenario: Lines of General's card

- **WHEN** the project root checkout is on `main`
- **THEN** General's card shows a title line holding the folder icon, `General`, and the menu button, then a branch line showing `main`

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
- **THEN** its card shows the lines of its head followed directly by the New terminal row, with no placeholder text

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

### Requirement: Every worktree has a folder

In a project whose root is inside a Git repository, every worktree of that repository other than the checkout at the project root SHALL have exactly one linked folder, however the worktree was created. The server SHALL create the folder when it first observes the worktree. A linked folder SHALL be reorderable independently of its worktree. It SHALL have no name of its own for a user to change: it is named by its label, which follows its worktree. It SHALL NOT be deletable on its own: the only way to remove a linked folder SHALL be to delete its worktree, which removes the worktree from disk. When a worktree is renamed or moved through Terminay, its folder SHALL stay linked to it. When a worktree disappears without Terminay having been asked to delete it, the server SHALL move its folder's panels to General, keeping every terminal running, and remove the folder.

#### Scenario: A worktree made outside Terminay

- **WHEN** a worktree is added to the project's repository from a shell outside Terminay
- **THEN** a linked folder for that worktree appears in the tree with no terminals, named by its label

#### Scenario: Existing worktrees

- **WHEN** a project is opened on a repository that already has three other worktrees
- **THEN** the tree shows General and three linked folders

#### Scenario: Deleting a linked folder

- **WHEN** a client requests that a linked folder be deleted while its worktree exists
- **THEN** the server refuses the command, and the folder's menu offers Delete worktree and no Delete folder

#### Scenario: Worktree removed outside Terminay

- **WHEN** a worktree whose folder holds a running terminal is removed from a shell with `git worktree remove`
- **THEN** the terminal is in General, still running, and the linked folder is gone

#### Scenario: Worktree moved outside Terminay

- **WHEN** a worktree whose folder holds a running terminal is moved from a shell with `git worktree move`
- **THEN** the same folder is linked to the worktree's new path with the terminal still in it

#### Scenario: Worktree directory deleted

- **WHEN** the directory of a worktree is deleted while Git still registers the worktree
- **THEN** its folder remains with its terminals, is marked missing, its Files and Changes panes say the directory is missing without reporting an error, and Delete worktree removes Git's record

### Requirement: Folder context menu

A folder row SHALL offer a context menu. For a linked folder and for General in a Git project it SHALL offer Commit & push with AI, Pull from origin, Copy path, Copy relative path, Open shell in folder, and Reveal in OS, each acting on that folder's worktree and each subject to the same Git and host constraints as the worktree action it performs. A linked folder SHALL additionally offer Rename worktree and Delete worktree, and SHALL NOT offer Rename folder. A plain folder SHALL offer Rename folder, Delete folder, Copy path, Open shell in folder, and Reveal in OS, acting on the project root, and SHALL offer no Git action. General in a project that is not a Git repository SHALL offer Copy path, Open shell in folder, and Reveal in OS. Open shell in folder SHALL create the terminal in that folder.

#### Scenario: Linked folder menu

- **WHEN** a user opens the context menu on a linked folder
- **THEN** it offers Commit & push with AI, Pull from origin, Rename worktree, Delete worktree, Copy path, Copy relative path, Open shell in folder, and Reveal in OS, and no Rename folder

#### Scenario: Plain folder menu

- **WHEN** a user opens the context menu on a plain folder
- **THEN** it offers Rename folder, Delete folder, Copy path, Open shell in folder, and Reveal in OS, and no pull, commit, or worktree action

#### Scenario: Open shell in folder

- **WHEN** a user chooses Open shell in folder on a linked folder
- **THEN** a terminal is created in that folder, starting in its worktree

#### Scenario: Pull is not possible

- **WHEN** a linked folder's worktree has no remote to pull from
- **THEN** Pull from origin is unavailable for the same reason the worktree action reports

## ADDED Requirements

### Requirement: Linked folder details tooltip

A linked folder's card SHALL show a details tooltip when the pointer has rested on its title line for one second, and when keyboard focus has rested on the card for one second. The tooltip SHALL NOT appear sooner. It SHALL show three labelled lines in this order: `Branch`, the branch of the worktree, or `detached at` and the short commit when the worktree has no branch; `Worktree`, the name of the worktree's directory; and `Location`, the worktree's path as the server reports it. Each line SHALL be a single unwrapped line. A location too long for the tooltip SHALL be truncated at its start with an ellipsis, so that the end of the path is shown; a branch or worktree name too long SHALL be truncated at its end.

The tooltip SHALL close when the pointer leaves the title line, when focus leaves the card, on Escape, on a press, when the tree scrolls, when a drag starts, and when the folder's menu opens, and a pending tooltip SHALL be cancelled by any of these. The tooltip SHALL NOT receive pointer input, SHALL NOT be clipped by the Folders column, and SHALL stay inside the window. Its content SHALL be exposed to assistive technology as the card's description. General and plain folders SHALL show no details tooltip.

#### Scenario: Resting on a worktree

- **WHEN** the pointer rests for one second on the title line of a linked folder whose worktree is on `feat/reorder-rows` in `/Users/mark/Projects/terminay/.claude/worktrees/reorder-rows`
- **THEN** a tooltip shows `Branch` `feat/reorder-rows`, `Worktree` `reorder-rows`, and `Location` with that path, on three lines

#### Scenario: Passing over a worktree

- **WHEN** the pointer crosses a linked folder's title line and leaves it within one second
- **THEN** no tooltip is shown

#### Scenario: Long location

- **WHEN** the tooltip is shown for a worktree whose path is wider than the tooltip
- **THEN** the location is one line that begins with an ellipsis and ends with the worktree's directory name

#### Scenario: Detached worktree

- **WHEN** the tooltip is shown for a worktree on a detached HEAD at commit `16be2864`
- **THEN** its first line shows `Branch` `detached at 16be2864`

#### Scenario: Keyboard focus

- **WHEN** keyboard focus rests on a linked folder's card for one second
- **THEN** the tooltip is shown, and pressing Escape closes it

#### Scenario: Opening the menu

- **WHEN** a user opens a linked folder's menu while its tooltip is shown or pending
- **THEN** the tooltip is not shown beside the menu

#### Scenario: General

- **WHEN** the pointer rests on General's title line for one second
- **THEN** no details tooltip is shown
