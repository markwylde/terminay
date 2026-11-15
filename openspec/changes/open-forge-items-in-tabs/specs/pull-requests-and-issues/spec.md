## ADDED Requirements

### Requirement: Opening an item as a Home tab

Double-clicking a row in Home's Pull Requests or Issues list SHALL open that
item as a Home tab of its own, and SHALL leave the row selected. A single click
SHALL select the row and show its detail beside the list, as before. Opening
an item that already has a Home tab SHALL bring that tab to the front instead
of opening a second one.

#### Scenario: Double-clicking an issue on Home

- **WHEN** a user double-clicks issue #540 in Home › Issues
- **THEN** a Home tab for #540 opens in front, showing its detail

#### Scenario: Opening the same item twice

- **WHEN** issue #540 already has a Home tab and the user double-clicks its row
  again
- **THEN** that tab comes to the front and no second tab opens

### Requirement: Home item tabs are remembered

A Home item tab SHALL belong to the Pull Requests or Issues section by the
item's kind, and SHALL be remembered and restored as the device's other Home
tabs are. A remembered tab for an item on a server other than the window's
SHALL say so and SHALL NOT ask the window's server for it.

#### Scenario: Tab of another server

- **WHEN** a window restores a Home tab for an issue on a server other than the
  one it is connected to
- **THEN** the tab says the item is on another server and no detail is asked
  for

### Requirement: Opening an item as a folder tab

Double-clicking a row in a project's Git tab SHALL open that item as a tab in
the selected folder, beside that folder's terminals and files, and SHALL NOT
select Home. A single click SHALL do what activating the row does otherwise,
once the time for a second click has passed without one; activating the row
from the keyboard SHALL act at once. Opening an item that already has a tab in
that folder SHALL bring the tab to the front.

#### Scenario: Double-clicking a pull request in a worktree's Git tab

- **WHEN** a user whose selected folder is the worktree `review-535`
  double-clicks pull request #535 in the project's Git tab
- **THEN** a tab for #535 opens in `review-535` and Home is not selected

#### Scenario: Single click in the Git tab

- **WHEN** a user clicks pull request #535 once in a project's Git tab, on a
  client not bound to the project
- **THEN** after a moment Home's Pull Requests section shows the repository
  with #535 selected

### Requirement: Folder item tabs are device presentation

A folder's item tab SHALL be presentation on the device: the server SHALL NOT
store it, and closing it SHALL close only the view. The Folders tree and Tabs
dashboard SHALL list it as a pull request or issue, never as a terminal.

#### Scenario: Listed in the Folders tree

- **WHEN** a folder holds a terminal and a tab for pull request #535
- **THEN** the Folders tree lists the #535 tab under that folder with a pull
  request mark, and the Tabs dashboard does not count it as a terminal

### Requirement: Open in tab action

The item detail SHALL offer **Open in tab** wherever its item can be opened as
a tab, doing what double-clicking its row does: on Home it SHALL open a Home
tab, and in a project's Git tab it SHALL open a tab in the selected folder.

#### Scenario: Opening a tab without a double click

- **WHEN** a user on a phone selects issue #540 in Home › Issues and activates
  Open in tab
- **THEN** a Home tab for #540 opens

### Requirement: Item tab contents

An item tab SHALL show the item's detail with the same content and actions as
the detail pane, fetched from its source when the tab is shown. Before the item
has loaded the tab SHALL be titled by its repository and number, and after by
its number and title. A failure to load SHALL be shown with its reason and a
way to retry.

#### Scenario: Tab title

- **WHEN** the tab for issue #540 of `acme/terminay`, titled "Open issues and
  prs in a new tab", has loaded
- **THEN** the tab is titled "#540 Open issues and prs in a new tab"
