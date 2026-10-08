## ADDED Requirements

### Requirement: Folders within a project

A project SHALL be composed of an ordered list of folders, and every panel of the project SHALL belong to exactly one of them. A folder SHALL have a stable server-issued id, a name, a kind, an ordered list of panels, and its own panel layout. The kinds SHALL be **General**, **plain**, and **linked**. A folder SHALL NOT be an identity or authorization boundary: a terminal's authority SHALL be its server, project, and session, whichever folder holds it.

#### Scenario: Every panel has a folder

- **WHEN** a project with terminal, file, and folder panels is published to a client
- **THEN** each panel names exactly one folder of that project, and each folder lists its panels in order

#### Scenario: A folder does not change authority

- **WHEN** a terminal moves from one folder to another in the same project
- **THEN** its session id, its project, its capabilities, and its attachments are unchanged

### Requirement: The General folder

Every project SHALL have exactly one General folder, created with the project. General SHALL be first in the folder order and SHALL NOT be renamed, reordered, or deleted. A panel created without a folder SHALL land in General. In a project whose root is a Git checkout, General SHALL represent that checkout.

#### Scenario: New project

- **WHEN** a project is created
- **THEN** it has one folder, General, holding the project's first terminal

#### Scenario: General cannot be removed

- **WHEN** a client requests that General be renamed, moved in the folder order, or deleted
- **THEN** the server refuses the command and General is unchanged

### Requirement: A folder holds its own panel layout

Each folder SHALL hold its own panel layout: its tab groups, splits, and panel order. Selecting a folder SHALL present that folder's layout in the project's panel area, and SHALL NOT change the layout of any other folder. Terminals in folders that are not selected SHALL keep running, keep receiving output, and keep their scrollback, exactly as terminals in a background project do.

#### Scenario: Switching folders

- **WHEN** a user arranges two terminals side by side in one folder, selects another folder, and returns
- **THEN** the first folder presents the same two terminals side by side

#### Scenario: Output continues in an unselected folder

- **WHEN** a terminal in an unselected folder runs a long-lived command
- **THEN** it keeps running, and its output is present when its folder is selected again

### Requirement: The Folders tree

A project SHALL present a Folders tree in a column to the left of its panel area. The tree SHALL list the project's folders in order and, under each, that folder's terminals in panel order with each terminal's status indicator and title. Every row SHALL be a single unwrapped line that truncates with an ellipsis. A folder with no terminals SHALL show a quiet placeholder row rather than nothing. The folder that holds the focused panel SHALL be marked as selected and the focused terminal's row SHALL be marked as active. The tree SHALL offer New folder. The column's header SHALL use the project chrome so the colour band continues across the tree, the panel tab strip, and the sidebar.

#### Scenario: Reading the tree

- **WHEN** a project has General with one terminal and a linked folder with two
- **THEN** the tree shows General and its terminal, then the linked folder and its two terminals, each terminal with its status indicator

#### Scenario: Selecting a terminal

- **WHEN** a user selects a terminal row in another folder
- **THEN** that folder becomes the selected folder, its layout is presented, and that terminal is focused

#### Scenario: Selecting a folder

- **WHEN** a user selects a folder row
- **THEN** that folder's layout is presented with the terminal that was last active in it focused

#### Scenario: Empty folder

- **WHEN** a folder holds no terminals
- **THEN** its row is followed by a placeholder row stating that it has no terminals yet

#### Scenario: Long titles

- **WHEN** a terminal title is longer than the tree is wide
- **THEN** the row stays one line and the title is truncated with an ellipsis

### Requirement: The selected folder is a device choice

Which folder is selected in a project SHALL be local to each device, like the active panel. It SHALL NOT be sent to the server and SHALL NOT affect another device viewing the same project. A device with no remembered choice for a project SHALL select General.

#### Scenario: Two devices

- **WHEN** two devices show the same project and one selects a different folder
- **THEN** the other device keeps its own selected folder

#### Scenario: First visit

- **WHEN** a device opens a project it has no remembered folder for
- **THEN** General is selected

### Requirement: Plain folders

A user SHALL be able to create a plain folder with a name, rename it, move it in the folder order after General, and delete it. Deleting an empty plain folder SHALL remove it at once. The server SHALL refuse a name a user gives a folder when another folder of the project already has it, comparing without regard to letter case. A linked folder SHALL take its worktree directory's name whatever else has that name.

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

When a user deletes a plain folder, or deletes the worktree of a linked folder, and that folder still holds panels, Terminay SHALL ask what to do with them before anything is deleted, offering **Move to General**, **Close them**, and Cancel. Move to General SHALL move every panel to General with its terminals still running. Close them SHALL close every panel through the normal close path, including close protection for a terminal with a non-shell foreground process and dirty confirmation for a file. The folder, and for a linked folder its worktree, SHALL be deleted only after the chosen outcome has been committed for every panel; if any panel remains in the folder, nothing SHALL be deleted. This question SHALL be in addition to, and SHALL come before, the confirmation a worktree removal already requires.

#### Scenario: Moving the terminals

- **WHEN** a user deletes a plain folder holding two running terminals and chooses Move to General
- **THEN** both terminals are in General, still running, and the folder is gone

#### Scenario: Closing the terminals

- **WHEN** a user deletes a worktree whose folder holds two idle terminals and chooses Close them
- **THEN** both terminals are closed, the worktree is removed after its own confirmation, and the folder is gone

#### Scenario: A busy terminal is kept running

- **WHEN** the user chooses Close them, and then chooses Keep Running for a terminal with a non-shell foreground process
- **THEN** that terminal stays in the folder and neither the folder nor the worktree is deleted

#### Scenario: Cancel

- **WHEN** the user cancels the question
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

In a project whose root is inside a Git repository, every worktree of that repository other than the checkout at the project root SHALL have exactly one linked folder, however the worktree was created. The server SHALL create the folder when it first observes the worktree and SHALL name it after the worktree's directory. A linked folder SHALL be renameable and reorderable independently of its worktree. It SHALL NOT be deletable on its own: the only way to remove a linked folder SHALL be to delete its worktree, which removes the worktree from disk. When a worktree is renamed or moved through Terminay, its folder SHALL stay linked to it. When a worktree disappears without Terminay having been asked to delete it, the server SHALL move its folder's panels to General, keeping every terminal running, and remove the folder.

#### Scenario: A worktree made outside Terminay

- **WHEN** a worktree is added to the project's repository from a shell outside Terminay
- **THEN** a linked folder named after that worktree's directory appears in the tree with no terminals

#### Scenario: Existing worktrees

- **WHEN** a project is opened on a repository that already has three other worktrees
- **THEN** the tree shows General and three linked folders

#### Scenario: Renaming the folder

- **WHEN** a user renames a linked folder
- **THEN** the folder shows the new name and its worktree's directory and branch are unchanged

#### Scenario: Deleting a linked folder

- **WHEN** a client requests that a linked folder be deleted while its worktree exists
- **THEN** the server refuses the command, and the folder's menu offers Delete worktree and no Delete folder

#### Scenario: Worktree removed outside Terminay

- **WHEN** a worktree whose folder holds a running terminal is removed from a shell with `git worktree remove`
- **THEN** the terminal is in General, still running, and the linked folder is gone

#### Scenario: Worktree moved outside Terminay

- **WHEN** a worktree whose folder holds a running terminal is moved from a shell with `git worktree move`
- **THEN** the same folder is linked to the worktree's new path with the terminal still in it, and a folder that was still named after the old directory is named after the new one

#### Scenario: Worktree directory deleted

- **WHEN** the directory of a worktree is deleted while Git still registers the worktree
- **THEN** its folder remains with its terminals, is marked missing, its Files and Changes panes say the directory is missing without reporting an error, and Delete worktree removes Git's record

### Requirement: Linked folder presentation

A linked folder's row SHALL show, beneath its name, the branch of its worktree, and the pull request and check state published for that worktree when there are any. General SHALL show the branch of the project root checkout in the same place. A plain folder SHALL show its name only.

#### Scenario: Worktree with a pull request

- **WHEN** a linked folder's worktree is on `feat/one-project-one-window` with pull request 350 and a passing check summary
- **THEN** the folder row shows that branch, `#350`, and the check summary beneath the folder name

#### Scenario: Worktree without a pull request

- **WHEN** a linked folder's worktree has no pull request
- **THEN** the folder row shows the branch alone

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

The terminal that created a worktree SHALL be the terminal of the project in whose process tree the Git command that registered the worktree ran. The server SHALL establish that from the terminal and from Git alone; it SHALL NOT depend on which agent, if any, is running in the terminal, and SHALL behave the same for an agent, a script, and a person typing the command. With the **Move terminals into new worktree folders** setting on, the server SHALL move that terminal into the worktree's folder as an ordinary folder move. A device on which that terminal was focused SHALL select the new folder and keep the terminal focused, and SHALL show a notice naming the terminal with an Undo action. Undo SHALL return the terminal to the folder it came from, and Terminay SHALL NOT move that terminal into that folder again on its own. When the command did not run in a terminal of the project, or the server cannot establish which terminal ran it, no terminal SHALL be moved. A worktree that already existed when the project was opened SHALL NOT cause any terminal to move.

#### Scenario: An agent creates a worktree

- **WHEN** an agent in a General terminal runs `git worktree add`
- **THEN** a linked folder for the worktree appears, that terminal is in it, the device that was looking at the terminal is still looking at it, and a notice offers Undo

#### Scenario: A person creates a worktree

- **WHEN** a user types `git worktree add` at the shell prompt of a General terminal
- **THEN** the same terminal is moved into the worktree's folder with the same notice

#### Scenario: Undo

- **WHEN** the user chooses Undo on the notice
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

A folder row SHALL offer a context menu. For a linked folder and for General in a Git project it SHALL offer Commit & push with AI, Pull from origin, Copy path, Copy relative path, Open shell in folder, and Reveal in OS, each acting on that folder's worktree and each subject to the same Git and host constraints as the worktree action it performs. A linked folder SHALL additionally offer Rename folder, Rename worktree, and Delete worktree. A plain folder SHALL offer Rename folder, Delete folder, Copy path, Open shell in folder, and Reveal in OS, acting on the project root, and SHALL offer no Git action. General in a project that is not a Git repository SHALL offer Copy path, Open shell in folder, and Reveal in OS. Open shell in folder SHALL create the terminal in that folder.

#### Scenario: Linked folder menu

- **WHEN** a user opens the context menu on a linked folder
- **THEN** it offers Commit & push with AI, Pull from origin, Rename folder, Rename worktree, Delete worktree, Copy path, Copy relative path, Open shell in folder, and Reveal in OS

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
