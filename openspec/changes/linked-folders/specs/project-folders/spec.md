## MODIFIED Requirements

### Requirement: Folders within a project

A project SHALL be composed of an ordered list of folders, and every panel of the project SHALL belong to exactly one of them. A folder SHALL have a stable server-issued id, a name, a kind, an ordered list of panels, and its own panel layout. The kinds SHALL be **General**, **plain**, and **linked**. A folder SHALL NOT be an identity or authorization boundary: a terminal's authority SHALL be its server, project, and session, whichever folder holds it.

#### Scenario: Every panel has a folder

- **WHEN** a project with terminal, file, and folder panels is published to a client
- **THEN** each panel names exactly one folder of that project, and each folder lists its panels in order

#### Scenario: A folder does not change authority

- **WHEN** a terminal moves from one folder to another in the same project
- **THEN** its session id, its project, its capabilities, and its attachments are unchanged

### Requirement: The General folder

Every project SHALL have exactly one General folder, created with the project. General SHALL NOT be renamed or deleted. General SHALL take any place in the folder order, as any other folder does. A panel created without a folder SHALL land in General, wherever General is in the order. In a project whose root is a Git checkout, General SHALL represent that checkout.

#### Scenario: New project

- **WHEN** a project is created
- **THEN** it has one folder, General; while the project awaits a start choice it holds no panels, and after the choice it holds the project’s first terminal

#### Scenario: General cannot be removed

- **WHEN** a client requests that General be renamed or deleted
- **THEN** the server refuses the command and General is unchanged

#### Scenario: General moved down the order

- **WHEN** a client requests a folder order that places General after another folder of the project
- **THEN** the server commits that order and every device showing the project lists General in its new place

#### Scenario: A panel with no folder after General has moved

- **WHEN** General is last in a project's folder order and a panel is created in that project without naming a folder
- **THEN** the panel lands in General

### Requirement: A folder holds its own panel layout

Each folder SHALL hold its own panel layout: its tab groups, splits, and panel order. Selecting a folder SHALL present that folder's layout in the project's panel area, and SHALL NOT change the layout of any other folder. Terminals in folders that are not selected SHALL keep running, keep receiving output, and keep their scrollback, exactly as terminals in a background project do.

#### Scenario: Switching folders

- **WHEN** a user arranges two terminals side by side in one folder, selects another folder, and returns
- **THEN** the first folder presents the same two terminals side by side

#### Scenario: Output continues in an unselected folder

- **WHEN** a terminal in an unselected folder runs a long-lived command
- **THEN** it keeps running, and its output is present when its folder is selected again

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

### Requirement: The selected folder is a device choice

Which folder is selected in a project SHALL be local to each device, like the active panel. It SHALL NOT be sent to the server and SHALL NOT affect another device viewing the same project. A device with no remembered choice for a project SHALL select General.

#### Scenario: Two devices

- **WHEN** two devices show the same project and one selects a different folder
- **THEN** the other device keeps its own selected folder

#### Scenario: First visit

- **WHEN** a device opens a project it has no remembered folder for
- **THEN** General is selected

### Requirement: Plain folders

A user SHALL be able to create a plain folder with a name, rename it, move it to any place in the folder order, and delete it. Deleting an empty plain folder SHALL remove it at once. The server SHALL refuse a name a user gives a folder when another folder of the project already has it, comparing without regard to letter case. A linked folder SHALL take its worktree directory's name whatever else has that name.

#### Scenario: Creating a folder

- **WHEN** a user chooses New folder and names it
- **THEN** an empty plain folder with that name is added to the end of the project's folders on every connected device

#### Scenario: A name already in use

- **WHEN** a user names a new folder General, or renames a folder to the name of another folder of the project
- **THEN** the server refuses, no folder is created or renamed, and the user is told the name is taken

#### Scenario: Deleting an empty folder

- **WHEN** a user deletes a plain folder that holds no panels
- **THEN** the folder is gone and nothing is asked

### Requirement: Deleting a folder that still holds panels

When a user deletes the worktree of a linked folder, or deletes a plain folder that still holds panels, Terminay SHALL show exactly one dialog before anything is deleted, with a **Cancel** button and a **Delete** button. When the folder holds panels, the dialog SHALL offer a choice of what happens to them, **Move to General** or **Close them**, with Move to General selected when the dialog opens. For a worktree, the dialog SHALL name the worktree and its path and SHALL state the worktree removal warning. When Close them is selected and any of the folder's terminals has a non-shell foreground process, the dialog SHALL state how many, and that closing stops them. Cancel, Escape, and a click outside the dialog SHALL leave the folder, its panels, and its worktree unchanged.

After the user chooses Delete, Terminay SHALL ask nothing further. Move to General SHALL move every panel to General with its terminals still running. Close them SHALL close every panel without close-protection prompts, saving any autosaving file panel first. The folder, and for a linked folder its worktree, SHALL be deleted only after the chosen outcome has been committed for every panel the dialog covered. If any panel cannot be moved or closed, or a panel the dialog did not cover is in the folder, nothing SHALL be deleted and Terminay SHALL report why as an error rather than as another question.

#### Scenario: Moving the terminals

- **WHEN** a user deletes a plain folder holding two running terminals, keeps Move to General selected, and chooses Delete
- **THEN** both terminals are in General, still running, and the folder is gone
- **AND** no other prompt was shown

#### Scenario: Closing the terminals

- **WHEN** a user deletes a worktree whose folder holds two idle terminals, selects Close them, and chooses Delete
- **THEN** both terminals are closed, the worktree is removed, and the folder is gone
- **AND** no other prompt was shown

#### Scenario: Closing a busy terminal

- **WHEN** a user deletes a worktree whose folder holds a terminal with a non-shell foreground process and selects Close them
- **THEN** the dialog states that one terminal has a running process that closing will stop
- **AND** after Delete the terminal is closed and the worktree removed without a further prompt

#### Scenario: Worktree with no panels

- **WHEN** a user deletes a worktree whose folder holds no panels
- **THEN** one dialog with the removal warning, Cancel, and Delete is shown, without a choice about panels

#### Scenario: A panel arrives during the delete

- **WHEN** a panel the dialog did not cover is in the folder once the chosen outcome has been applied
- **THEN** neither the folder nor the worktree is deleted, that panel is left as it is, and an error says why

#### Scenario: Cancel

- **WHEN** the user cancels the dialog
- **THEN** the folder, its panels, and its worktree are unchanged

### Requirement: A folder with no panels shows a placeholder

When the selected folder holds no panels, the project's panel area SHALL show a placeholder in place of a layout. The placeholder SHALL name the folder, state that it has no terminals open, and offer New terminal, which SHALL create a terminal in that folder. For a linked folder it SHALL also name the worktree the terminal will start in. The project SHALL stay open, and the Folders tree and the project sidebar SHALL remain available.

#### Scenario: Selecting an empty linked folder

- **WHEN** a user selects a linked folder that holds no panels
- **THEN** the panel area shows a placeholder naming the folder and its worktree, with a New terminal action

#### Scenario: Opening a terminal from the placeholder

- **WHEN** a user chooses New terminal on the placeholder
- **THEN** a terminal is created in that folder and its layout replaces the placeholder

#### Scenario: Closing the last terminal in a folder

- **WHEN** a user closes the only panel in the selected folder
- **THEN** the folder stays selected and shows the placeholder

### Requirement: Moving a panel between folders

A user SHALL be able to move a panel to another folder of the same project, by dragging its tab or its tree row onto a folder row or by choosing the folder from the panel's menu. The move SHALL be committed by the server and presented only once committed. A moved terminal SHALL keep its session id, scrollback, title, colour, emoji, note, and recording state, its process SHALL keep running, and no credential or attachment SHALL be revoked. On the device that requested the move, the target folder SHALL become selected and the moved panel focused.

#### Scenario: Dragging a terminal onto a folder

- **WHEN** a user drags a terminal's tree row onto another folder's row
- **THEN** the terminal is presented in that folder on every device, with the same session id and scrollback

#### Scenario: The source folder keeps its layout

- **WHEN** a terminal is moved out of a folder that holds other panels
- **THEN** the remaining panels keep their arrangement

#### Scenario: Move refused

- **WHEN** the server refuses a folder move
- **THEN** the panel stays in its folder, running, and the reason is shown

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

### Requirement: A folder has a root chosen by the server

Every folder SHALL have a root directory that the server determines: the worktree path for a linked folder, and the project root for General and for a plain folder. The server SHALL resolve a folder's root from its own canonical worktree listing each time an operation needs it. A client SHALL name a folder by id only; a path supplied by a client SHALL NEVER define a folder's root or widen what a project may read or write.

#### Scenario: Files follow the folder

- **WHEN** a linked folder is selected
- **THEN** the Files pane lists that folder's worktree, and the project's root is unchanged

#### Scenario: A terminal created in a linked folder

- **WHEN** a user creates a terminal in a linked folder with no other directory to inherit
- **THEN** the terminal starts in that folder's worktree

#### Scenario: Client names a folder of another project

- **WHEN** a request names a folder id that does not belong to the request's project
- **THEN** the server refuses it before reading or changing anything

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

### Requirement: Offering the move instead of making it

With the **Move terminals into new worktree folders** setting off, the server SHALL still create the worktree's folder and SHALL record an offer on it naming the terminal that created the worktree, in place of moving the terminal. Every device SHALL present that offer beneath the folder with **Move it here** and **Not now**. Accepting SHALL move the terminal as an ordinary folder move; declining SHALL clear the offer for every device. A terminal that created a worktree and is not in that worktree's folder SHALL show the worktree's name as a tag on its tree row.

#### Scenario: Setting off

- **WHEN** the setting is off and an agent in a General terminal creates a worktree
- **THEN** the linked folder appears with an offer naming that terminal, the terminal stays in General with a tag naming the worktree, and nothing else moves

#### Scenario: Accepting the offer

- **WHEN** the user chooses Move it here
- **THEN** the terminal is in the linked folder and the offer is gone on every device

#### Scenario: Declining the offer

- **WHEN** the user chooses Not now
- **THEN** the offer is gone on every device and the terminal stays in General with its tag

### Requirement: The capture setting

**Move terminals into new worktree folders** SHALL be a server setting, on by default. Changing it SHALL affect worktrees that appear afterwards only.

#### Scenario: Default

- **WHEN** a server has never had the setting changed
- **THEN** a terminal that creates a worktree is moved into its folder

#### Scenario: Changing the setting

- **WHEN** the setting is turned off while a terminal captured earlier sits in a linked folder
- **THEN** that terminal stays where it is

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

### Requirement: Projects without Git

In a project whose root is not inside a Git repository, the Folders tree SHALL show General and any plain folders only. No folder SHALL show a branch line, no terminal SHALL be tagged or offered a move, and no Git action SHALL be offered. If the project root later becomes a repository, General and its worktrees SHALL gain their Git presentation without a restart.

#### Scenario: A folder of notes

- **WHEN** a project is opened on a directory with no repository and the user creates several terminals
- **THEN** every terminal is in General, no row shows a branch, and nothing is suggested

#### Scenario: Repository initialised later

- **WHEN** `git init` is run at the project root
- **THEN** General shows the new branch without the project being reopened

### Requirement: Activating a terminal selects its folder

Wherever a terminal is activated from outside its folder, including the Home dashboard, the Agents pane, a notification, tab peek, a compact switcher, and an MCP focus request, the device SHALL select that terminal's folder before focusing it.

#### Scenario: From the dashboard

- **WHEN** a user activates a dashboard row for a terminal in a folder that is not selected
- **THEN** its project is shown with that folder selected and that terminal focused

### Requirement: Folders on a compact workspace

On a compact workspace the Folders tree SHALL NOT be presented as a column. The unified switcher SHALL list each project's folders, with each folder's terminals beneath it, so that a terminal in any folder is reachable from the switcher.

#### Scenario: Phone width

- **WHEN** a project with General and one linked folder is shown at phone width
- **THEN** no Folders column is present, and the switcher lists both folders with their terminals
