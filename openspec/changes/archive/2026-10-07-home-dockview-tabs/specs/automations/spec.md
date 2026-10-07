## MODIFIED Requirements

### Requirement: Automation terminal space

Terminals launched by automations, and terminals that automation commands open through MCP, SHALL live in an automation terminal space on the owning server. That space SHALL NOT be a project: it SHALL NEVER appear in project ordering, project tabs, the switcher, or the Tabs section, and SHALL persist independently of every project. Its terminals SHALL be listed in the Automations section, grouped by run, and opening one SHALL show it in a Home tab of its own, where a user can view, focus, type into, and close it as an ordinary terminal. Closing that Home tab SHALL leave the terminal running and listed; the terminal SHALL be closed only by its own close action. When a run ends, its terminal SHALL close unless the automation's "keep terminal after run" setting is on; terminals opened by a run through MCP SHALL remain open until closed.

#### Scenario: Run terminal closes by default

- **WHEN** a run of an automation with "keep terminal after run" off exits
- **THEN** its terminal closes and the run log keeps its outcome and output tail

#### Scenario: Keep terminal after run

- **WHEN** a run of an automation with "keep terminal after run" on exits
- **THEN** its terminal stays listed in the Automations section until the user closes it

#### Scenario: Agent spawned by a scheduled script

- **WHEN** a scheduled script opens a terminal through MCP and starts an agent in it
- **THEN** that terminal is listed in the Automations section under the run that opened it and stays open after the script exits

#### Scenario: Not a project

- **WHEN** projects are listed, ordered, or shown in the Tabs section
- **THEN** the automation terminal space is absent

#### Scenario: Closing the tab keeps the terminal

- **WHEN** a user closes the Home tab showing a running automation terminal
- **THEN** the terminal keeps running and is still listed in the Automations section

### Requirement: Automations section

The Automations section of Home SHALL list the automations of the selected server with each one's name, enabled state, trigger in plain words, next scheduled run where it has one, and last run outcome. When more than one connection is attached, the section SHALL offer a server selector, as the Macros surface does. From it a user SHALL be able to create, edit, duplicate, enable, disable, delete, and run an automation now; see its run history and open any run; and see the automation terminal space's terminals. The section SHALL stay a list: creating, opening, editing, and duplicating an automation, opening a run, and opening an automation terminal SHALL each open a Home tab and SHALL leave the list as it was. Running now SHALL start an ordinary logged run marked as started by a user and SHALL open that run's tab; for a subject-terminal action it SHALL ask the user to choose a subject terminal. Deleting an automation SHALL stop none of its runs already in progress and SHALL ask for confirmation.

#### Scenario: Creating a scheduled automation

- **WHEN** a user creates an automation with a daily-at-09:00 schedule that runs a command, and saves it enabled
- **THEN** it is listed with its trigger described in plain words and its next run time

#### Scenario: Run now

- **WHEN** a user runs a scheduled automation now
- **THEN** a run starts at once, is logged as started by a user, and its tab opens in front

#### Scenario: Two servers attached

- **WHEN** two connections are attached
- **THEN** the section offers a server selector and lists only the selected server's automations

#### Scenario: Opening an automation leaves the list

- **WHEN** a user activates an automation in the list
- **THEN** that automation's tab opens in front and the Automations tab is still open, showing the list, behind it

## ADDED Requirements

### Requirement: Automation tabs

Each of the following SHALL be shown in a Home tab of its own: an automation, with its definition in plain words, its controls, and its run history; an automation's editor; a new automation being created; a single run, with its outcome, duration, and output; and an automation terminal. Opening an automation, an automation's editor, a run, or an automation terminal that already has a tab SHALL bring that tab to the front rather than opening a second. Every activation of New automation or Duplicate SHALL open a further new automation tab, so that several drafts can be open at once. A tab SHALL be titled with the automation's name, a new automation's tab with the name typed so far or "New automation", and a run's tab with the automation's name and the run's start time. With more than one connection attached, a tab SHALL name the server that owns what it shows.

Saving in an editor or a new automation tab SHALL close that tab and bring the saved automation's tab to the front, opening it where it is not open. Cancelling SHALL close the tab and change nothing. A save the server refuses SHALL keep the tab open with everything typed and SHALL say why.

A tab SHALL follow what it shows. When an automation is renamed, its tabs SHALL take the new name. When an automation is deleted, on this or any other client, its tab, its editor, and its runs' tabs SHALL close. When a run is deleted, pruned, or aged out, its tab SHALL close. When a connection is no longer attached, the tabs showing that server's automations, runs, and terminals SHALL close.

#### Scenario: Automation and run side by side

- **WHEN** a user opens an automation and then opens one of its runs
- **THEN** the automation's tab and the run's tab are both open and can be arranged side by side

#### Scenario: Opening the same automation twice

- **WHEN** a user activates an automation whose tab is already open
- **THEN** that tab comes to the front and no second tab opens

#### Scenario: Two drafts at once

- **WHEN** a user activates New automation twice
- **THEN** two new automation tabs are open, each holding its own fields

#### Scenario: Saving a new automation

- **WHEN** a user saves a new automation tab
- **THEN** that tab closes, the automation's tab opens in front, and the automation is in the list

#### Scenario: Refused save

- **WHEN** the server refuses a save
- **THEN** the tab stays open with every field as typed and shows the reason

#### Scenario: Automation deleted elsewhere

- **WHEN** another client deletes an automation whose tab and editor are open on this device
- **THEN** both tabs close

### Requirement: Unsaved automation edits

An editor or new automation tab whose fields differ from what was last saved, or from an empty new automation, SHALL be marked as having unsaved edits on its tab. Closing such a tab — by its close control, by Cancel, or by a keyboard close — SHALL ask the user to discard the edits or keep editing, and SHALL close only on discard. A tab without unsaved edits SHALL close without asking. When a tab with unsaved edits must close because its automation was deleted or its connection is no longer attached, it SHALL close and the workspace SHALL say that the edits were dropped and why.

#### Scenario: Marked as unsaved

- **WHEN** a user changes a field in an automation's editor
- **THEN** the editor's tab is marked as having unsaved edits

#### Scenario: Closing with unsaved edits

- **WHEN** a user closes a new automation tab after typing a name
- **THEN** the workspace asks whether to discard the edits, and the tab stays open with the name as typed when the user chooses to keep editing

#### Scenario: Closing without edits

- **WHEN** a user opens an automation's editor and closes it without changing anything
- **THEN** the tab closes without asking

#### Scenario: Automation deleted under an edit

- **WHEN** an automation is deleted on another client while its editor holds unsaved edits on this device
- **THEN** the editor closes and the workspace says the edits were dropped because the automation was deleted
