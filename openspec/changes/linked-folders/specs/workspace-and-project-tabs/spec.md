## MODIFIED Requirements

### Requirement: Project composition

A project SHALL have an optional root folder on its server, a name, colour, icon, default shell-profile override, per-project navigation state, and an ordered list of folders, each holding terminal, file, and folder panels in its own Dockview layout. Projects and panels SHALL be movable between the projects and workspace views of that server, and a terminal title SHALL NEVER be an identity boundary. A window's tab strip SHALL present the projects of every attached connection interleaved in one strip, each tab bound to its owning server; that order SHALL be client-owned presentation state and SHALL NEVER be sent to a server.

#### Scenario: Project attributes
- **WHEN** a project exists in a workspace view
- **THEN** it carries an optional root folder on its server, name, colour, icon, shell-profile override, navigation state, and an ordered list of folders that each hold a Dockview layout of panels

#### Scenario: Title is not identity
- **WHEN** a terminal's title changes
- **THEN** no identity or authorization boundary changes

#### Scenario: Tabs from several servers
- **WHEN** a window attaches two servers that each hold projects
- **THEN** one strip shows every project of both, each tab bound to the server that owns it, in an order the client holds

### Requirement: Closing the final panel

Closing the final panel of a project SHALL leave the project open, with its selected folder showing the empty-folder placeholder. A project SHALL close only when the user closes the project itself. Closing the first project SHALL NOT unexpectedly quit the app.

#### Scenario: Last panel closed
- **WHEN** the final panel in a project is closed
- **THEN** the project stays open and its panel area shows the empty-folder placeholder

#### Scenario: Last panel of one folder closed
- **WHEN** the only panel in one folder is closed while another folder still holds panels
- **THEN** the project stays open, the folder stays selected, and no other folder's panels change

#### Scenario: First project closed
- **WHEN** the first project is closed while others remain
- **THEN** the application does not quit

### Requirement: Panel creation, splitting, and movement

New terminals SHALL open in the selected folder of the active project of that presentation. Tabs SHALL be able to split the active layout horizontally or vertically, be reordered, be moved to another folder of the same project, be moved to another project, or be moved into another workspace view. A split or a reorder SHALL affect the layout of the panel's own folder only. A panel moved to another project SHALL land in that project's General folder. A panel SHALL only move within its own server: a project or workspace view owned by another server SHALL NOT be offered as a drop target, and no panel or terminal SHALL be recreated on another server.

#### Scenario: New terminal lands in the selected folder
- **WHEN** a user creates a terminal while a linked folder is selected
- **THEN** the terminal is added to that folder's layout and to no other folder

#### Scenario: Splitting a layout
- **WHEN** a user splits the active layout horizontally or vertically
- **THEN** the panel layout updates in the selected folder of the active project

#### Scenario: Moving a panel to another project
- **WHEN** a panel is moved to another project or workspace view on the same server
- **THEN** it moves without losing its identity and is presented in the target project's General folder

#### Scenario: Dragging a panel toward another server's project
- **WHEN** a user drags a panel over a project owned by a different attached server
- **THEN** that project is not offered as a drop target and no move is attempted

## ADDED Requirements

### Requirement: Closing from the compact switcher

Each panel row in the compact switcher SHALL carry a close control that closes that panel through the same path and close-protection as a panel tab. Each project group heading SHALL carry a close control that closes that project through the same path and close-protection as a project tab. Closing a panel or a project SHALL leave the switcher open. Closing the last panel in a project SHALL leave the project open and listed. Close protection SHALL still ask whether to **Close Terminal** or **Keep Running** when that terminal's PTY has a non-shell foreground process, and SHALL still ask whether to **Close Project** or **Keep Running** when a project has such a terminal.

#### Scenario: Closing a terminal from the switcher
- **WHEN** a user presses the close control on a terminal row
- **THEN** that terminal closes and the switcher stays open

#### Scenario: Closing a file from the switcher
- **WHEN** a user presses the close control on a file row
- **THEN** that file panel closes and the switcher stays open

#### Scenario: Closing a busy terminal from the switcher
- **WHEN** a user presses the close control on a terminal whose PTY has a non-shell foreground process
- **THEN** Terminay asks whether to Close Terminal or Keep Running before terminating it

#### Scenario: Closing a project from the switcher
- **WHEN** a user presses the close control on a project group heading whose terminals are all at their shell prompts
- **THEN** that project closes and the switcher stays open

#### Scenario: Closing the last panel keeps the project
- **WHEN** a user closes the last remaining panel of a project from the switcher
- **THEN** the project stays open and stays listed in the switcher with no panel rows

### Requirement: Project tab peek

Resting the pointer on a project tab that is not the active tab SHALL open a peek beneath that tab showing that project's Folders tree: its folders in order, each folder's branch line where it has one, and each folder's terminals with their status indicators. Choosing a terminal in the peek SHALL make that project active on its own server, select that terminal's folder, and focus the terminal. Choosing a folder SHALL make the project active with that folder selected. The peek SHALL open only after the pointer has rested on the tab, SHALL close when the pointer leaves both the tab and the peek or when Escape is pressed, and SHALL NOT open for the active tab. The peek SHALL NOT open, and an open peek SHALL close, while a project tab or a panel tab is being dragged, so that reordering a tab, tearing it off into a new window, and dropping a terminal on a project tab behave exactly as they do without it. The peek SHALL be reachable from the keyboard when a project tab has focus. A device without hover SHALL NOT show the peek and SHALL reach the same terminals through the project switcher.

#### Scenario: Peeking at another project
- **WHEN** the pointer rests on a project tab that is not active
- **THEN** a peek opens beneath the tab listing that project's folders and their terminals with status indicators

#### Scenario: Jumping to a terminal
- **WHEN** a user chooses a terminal in the peek
- **THEN** that project becomes active, the terminal's folder is selected, the terminal is focused, and the peek closes

#### Scenario: Passing over a tab
- **WHEN** the pointer crosses a project tab without resting on it
- **THEN** no peek opens

#### Scenario: Tearing a tab off
- **WHEN** a user presses a project tab and drags it out of the tab strip
- **THEN** no peek is shown and the tab tears off into a new window

#### Scenario: Dropping a terminal on a project tab
- **WHEN** a user drags a terminal tab over a project tab
- **THEN** no peek is shown and the tab accepts the drop

#### Scenario: The active tab
- **WHEN** the pointer rests on the active project tab
- **THEN** no peek opens

#### Scenario: Keyboard
- **WHEN** a project tab that is not active has keyboard focus and the user presses the down arrow
- **THEN** the peek opens with its first row focused, and Escape closes it and returns focus to the tab

## REMOVED Requirements

### Requirement: Compact switcher closing

**Reason**: Closing the last panel of a project no longer closes the project. The rest of the contract is restated as "Closing from the compact switcher".

**Migration**: Close a project from its group heading in the switcher, or from its tab.
