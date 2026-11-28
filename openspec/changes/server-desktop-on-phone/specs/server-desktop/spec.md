## MODIFIED Requirements

### Requirement: Show Desktop sits beside the server menu

A window connected to a server that advertises `server-desktop.v1` SHALL show a Show Desktop control beside the server menu. A window whose server does not advertise it SHALL NOT show the control. In a wide window the control sits in the header: activating it SHALL open a dropdown beneath it for that window's server, and activating it again, pressing outside the dropdown, or pressing Escape SHALL close it. A window that narrows to phone width SHALL close an open dropdown. The dropdown SHALL present the server's state:

- `ready` shows a live, scaled copy of the desktop, who controls it, a way to take or give up control, and an action that opens the desktop in a tab.
- `needs-setup` and `setting-up` show guided setup.
- `off` offers to turn the desktop on.
- `unsupported` shows the reason and no action.
- `failed` shows the reason and a retry.

#### Scenario: Ready desktop

- **WHEN** a user activates Show Desktop on a server whose desktop is `ready`
- **THEN** a dropdown opens showing a live copy of the whole desktop and an action to open it in a tab

#### Scenario: Server without the capability

- **WHEN** a window is connected to a server that does not advertise `server-desktop.v1`
- **THEN** no Show Desktop control is shown

#### Scenario: Unsupported host

- **WHEN** a user activates Show Desktop on a server whose state is `unsupported`
- **THEN** the dropdown shows the reason, and shows no install, retry, or turn-on action

#### Scenario: Viewer resizes

- **WHEN** a view-only client resizes its window
- **THEN** the desktop keeps its size and that client's view is scaled to fit

#### Scenario: Narrowing with the dropdown open

- **WHEN** a wide window with the dropdown open narrows to phone width and is then widened again
- **THEN** the dropdown is closed

## ADDED Requirements

### Requirement: Show Desktop at phone width

At phone width the Show Desktop control SHALL be a row in the Servers panel of the drawer, beneath the list of servers, and SHALL open no dropdown. Choosing the row SHALL close the drawer and open a desktop tab in whatever the window is showing: the selected folder of the project in front, or Home. The desktop tab presents the server's state in the dropdown's place.

#### Scenario: Opening the desktop from a phone

- **WHEN** a user at phone width, with a project in front, chooses Show Desktop in the drawer's Servers panel
- **THEN** the drawer closes and a desktop tab is in front in that project's selected folder

#### Scenario: Opening the desktop from Home

- **WHEN** a user at phone width, with Home in front, chooses Show Desktop in the drawer's Servers panel
- **THEN** the drawer closes and a desktop tab is in front in Home

#### Scenario: Server without the capability at phone width

- **WHEN** a window at phone width is connected to a server that does not advertise `server-desktop.v1`
- **THEN** the Servers panel shows no Show Desktop row

#### Scenario: Desktop that needs setup

- **WHEN** a user at phone width chooses Show Desktop on a server whose desktop is `needs-setup`
- **THEN** the desktop tab that opens shows guided setup

### Requirement: A desktop tab is listed as a desktop

A desktop tab in a project SHALL be listed among that project's tabs as a desktop, under the title the tab shows, and never as a terminal. It SHALL NOT count toward a project's terminal counts. Choosing its row in the drawer SHALL bring that tab to the front. Its row menu SHALL offer Open, and Close while the window is on that tab's server, and SHALL NOT offer Rename or Move to folder.

#### Scenario: Returning to a desktop tab

- **WHEN** a user at phone width has a desktop tab and a terminal in one project, with the terminal in front, and chooses the desktop's row in the drawer
- **THEN** the desktop tab is in front

#### Scenario: Desktop row menu

- **WHEN** a user opens the menu of a desktop row in the drawer
- **THEN** the menu offers Open and Close, and offers neither Rename nor Move to folder

#### Scenario: Closing from the drawer

- **WHEN** a user chooses Close in a desktop row's menu
- **THEN** the desktop tab closes and is not there after the window reloads

#### Scenario: Not a terminal

- **WHEN** a project holds one terminal and one desktop tab
- **THEN** the project's summary counts one terminal

### Requirement: A desktop tab closes without a tab strip

At phone width, where no tab strip is drawn, a desktop tab in Home SHALL show a control that closes it, whatever state the desktop is in, and closing SHALL return to the tab that was in front before the desktop tab opened. A desktop tab in a project closes from its row in the drawer.

#### Scenario: Closing a Home desktop tab on a phone

- **WHEN** a user at phone width opens the desktop from Home's Automations section while the desktop is `needs-setup`, and then activates the desktop tab's close control
- **THEN** the desktop tab closes and the Automations tab is in front

#### Scenario: Wide window

- **WHEN** a desktop tab is shown in Home in a wide window
- **THEN** it shows no close control of its own, and its tab chip closes it
