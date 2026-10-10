## ADDED Requirements

### Requirement: The Folders tree lists every panel

Under each folder, the Folders tree SHALL list every panel that folder holds, of every kind a project can open as a tab: terminals, files (including documentation files), and folder tabs. A terminal SHALL be listed wherever the project is open. A file or folder tab SHALL be listed on a device that has that folder's tabs loaded, which is every folder the device has shown since it opened the project. Rows SHALL appear in the folder's panel order, the same order the compact switcher lists them, and a panel SHALL have exactly one row. A terminal's row SHALL show its status indicator and title. Any other panel's row SHALL show an icon for its kind in the place of the status indicator, and the same title its tab shows. Every row SHALL be a single unwrapped line that truncates with an ellipsis.

The row of the focused panel SHALL be highlighted as active, whatever its kind, and no other row SHALL be. Selecting a row SHALL select its folder, present that folder's layout, and focus that panel. A row SHALL offer what its panel's tab offers and nothing more: a terminal's row SHALL offer that terminal's tab context menu, renaming from the row, and dragging onto another folder to move it there; the row of a file or folder tab, whose tab has no context menu, no rename, and no move between folders, SHALL offer none of the three.

A folder SHALL count as empty, for its placeholder and for the tint of a selected folder with no active row, only when it holds no panel of any kind. The New terminal row SHALL follow the folder's last panel row.

#### Scenario: A folder with mixed panels

- **WHEN** a folder holds a terminal, an open file, and a folder tab, in that panel order
- **THEN** its card lists three rows in that order: the terminal with its status indicator, the file with a file icon, and the folder tab with a folder icon, each titled as its tab is
- **AND** the New terminal row follows them

#### Scenario: A documentation file

- **WHEN** a user opens a documentation file as a tab
- **THEN** the folder that holds it gains a row for it, titled as its tab is

#### Scenario: Opening and closing a file

- **WHEN** a user opens a file in a folder and later closes its tab
- **THEN** a row for it appears in that folder's card when it opens and is gone when it closes

#### Scenario: Selecting a file row in another folder

- **WHEN** a user selects a file's row in a folder that is not the selected one
- **THEN** that folder becomes the selected folder, its layout is presented, that file's panel is focused, and its row is the one highlighted

#### Scenario: A focused file

- **WHEN** the focused panel is a file
- **THEN** that file's row is highlighted and no terminal row is

#### Scenario: A file row offers what its tab offers

- **WHEN** a user right-clicks, double-clicks, or tries to drag a file's row
- **THEN** no terminal menu opens, no name field opens, and no drag starts
- **AND** a terminal's row in the same folder still offers all three

#### Scenario: A folder holding only files

- **WHEN** a folder holds one open file and no terminal
- **THEN** its card lists that file's row and shows no empty-folder placeholder

#### Scenario: Agreement with the compact switcher

- **WHEN** the same project is read in the Folders tree and in the compact switcher
- **THEN** each folder lists the same panels in the same order in both

### Requirement: Collapsing a folder in the tree

Every folder card in the Folders tree SHALL carry a collapse control at the leading end of its title line, General included. Activating it SHALL collapse an open folder to its title line alone, hiding its branch line, its facts line, its checks, its panel rows, and its New terminal row, and SHALL open a collapsed folder again. Collapsing or opening a folder SHALL NOT select it, close a panel, or stop a terminal. With focus on a folder's title row, the Left arrow key SHALL collapse an open folder and the Right arrow key SHALL open a collapsed one. The title row SHALL state to assistive technology whether the folder is open. A tree that only lists, such as a tab peek, SHALL show no collapse control and SHALL draw every folder open.

A collapsed folder's title line SHALL show one status indicator for all of its terminals: the most urgent state among them, in the order blocked, waiting, working, done. It SHALL show no indicator when every terminal in the folder is idle or the folder holds none. An open folder's title line SHALL show no such indicator, because each terminal row shows its own. A collapsed folder that is selected SHALL have its title line tinted, since no row can show where the user is. An unanswered offer to move a terminal into a folder SHALL stay visible while that folder is collapsed.

Which folders are collapsed SHALL belong to the current device and project, stored with device preferences under the selected server and opaque project id. It SHALL NOT sync to another device and SHALL NOT belong to canonical project state. A device with no preference SHALL draw every folder open.

#### Scenario: Collapsing a folder

- **WHEN** a user activates the collapse control on an open folder's title line
- **THEN** the card shows its title line alone, with no branch line, facts line, panel rows, or New terminal row
- **AND** the selected folder and the panel in front are unchanged

#### Scenario: Opening a collapsed folder

- **WHEN** a user activates the control on a collapsed folder's title line
- **THEN** the card shows everything it showed before it was collapsed

#### Scenario: One status for a collapsed folder

- **WHEN** a collapsed folder holds an idle terminal, a working terminal, and a waiting terminal
- **THEN** its title line shows one indicator, in the waiting state

#### Scenario: A quiet collapsed folder

- **WHEN** every terminal in a collapsed folder is idle
- **THEN** its title line shows no status indicator

#### Scenario: An open folder

- **WHEN** a folder is open and one of its terminals is working
- **THEN** that terminal's row shows the working state and the folder's title line shows no status indicator

#### Scenario: Selecting a collapsed folder

- **WHEN** a user selects a collapsed folder by its title
- **THEN** that folder's layout is presented, the folder stays collapsed, and its title line is tinted

#### Scenario: From the keyboard

- **WHEN** a folder's title row has focus and a user presses Left, then Right
- **THEN** the folder collapses, then opens

#### Scenario: Restart or reload

- **WHEN** the same device restarts or reloads
- **THEN** each project's folders are collapsed or open as they were left

#### Scenario: Another device

- **WHEN** a user collapses a folder on one device
- **THEN** no other device and no other project is affected

### Requirement: Carrying a folder by its title

A folder card SHALL be reordered by its title line, and SHALL show no separate drag grip. A press on the title line that then travels more than a small distance SHALL carry the card, under the rules for reordering folders from the tree. A press that is released before travelling that far SHALL be a click: it SHALL select the folder and carry nothing. A press that begins on a control of the title line, such as the collapse control or the menu button, SHALL be that control's and SHALL carry nothing however far it travels. Carrying a card SHALL NOT select a folder. A touch on the title line SHALL scroll the tree rather than carry the card. With focus on a folder's title row, Alt with the Up or Down arrow key SHALL move that folder one place, SHALL do nothing at the end of the order it points to, and SHALL keep focus on that folder's title row. A tree that only lists, such as a tab peek, SHALL carry no card.

#### Scenario: Dragging a title

- **WHEN** a user presses a folder's title and moves the pointer down past the next folder before letting go
- **THEN** the card is carried with the pointer and takes the place it is released over
- **AND** the folder that was selected is still the selected folder

#### Scenario: A press that barely moves

- **WHEN** a user presses a folder's title, moves the pointer a few pixels, and lets go
- **THEN** that folder is selected and the order of the folders is unchanged

#### Scenario: A press on a control

- **WHEN** a user presses the collapse control and drags well away before letting go
- **THEN** no card is carried and the order of the folders is unchanged

#### Scenario: From the keyboard

- **WHEN** a folder's title row has focus and a user presses Alt with Up
- **THEN** the folder moves up one place and its title row still has focus
