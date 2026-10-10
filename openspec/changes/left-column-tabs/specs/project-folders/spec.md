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
