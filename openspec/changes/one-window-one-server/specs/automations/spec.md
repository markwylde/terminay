## MODIFIED Requirements

### Requirement: Automation tabs

Each of the following SHALL be shown in a Home tab of its own: an automation, with its definition in plain words, its controls, and its run history; an automation's editor; a new automation being created; a single run, with its outcome, duration, and output; and an automation terminal. Opening an automation, an automation's editor, a run, or an automation terminal that already has a tab SHALL bring that tab to the front rather than opening a second. Every activation of New automation or Duplicate SHALL open a further new automation tab, so that several drafts can be open at once. A tab SHALL be titled with the automation's name, a new automation's tab with the name typed so far or "New automation", and a run's tab with the automation's name and the run's start time. Every tab SHALL show an automation, run, or terminal of the window's server, and SHALL NOT name a server.

Saving in an editor or a new automation tab SHALL close that tab and bring the saved automation's tab to the front, opening it where it is not open. Cancelling SHALL close the tab and change nothing. A save the server refuses SHALL keep the tab open with everything typed and SHALL say why.

A tab SHALL follow what it shows. When an automation is renamed, its tabs SHALL take the new name. When an automation is deleted, on this or any other client, its tab, its editor, and its runs' tabs SHALL close. When a run is deleted, pruned, or aged out, its tab SHALL close.

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

## ADDED Requirements

### Requirement: Automations list

The Automations section of Home SHALL list the automations of the window's server with each one's name, enabled state, trigger in plain words, next scheduled run where it has one, and last run outcome. The section SHALL NOT offer a control for choosing a server, SHALL NOT name a server on a row, and SHALL NOT list another server's automations. From it a user SHALL be able to create, edit, duplicate, enable, disable, delete, and run an automation now; see its run history and open any run; and see the automation terminal space's terminals. A new automation SHALL be created on the window's server. The section SHALL stay a list: creating, opening, editing, and duplicating an automation, opening a run, and opening an automation terminal SHALL each open a Home tab and SHALL leave the list as it was. Running now SHALL start an ordinary logged run marked as started by a user and SHALL open that run's tab; for a subject-terminal action it SHALL ask the user to choose a subject terminal. Deleting an automation SHALL stop none of its runs already in progress and SHALL ask for confirmation.

#### Scenario: Creating a scheduled automation

- **WHEN** a user creates an automation with a daily-at-09:00 schedule that runs a command, and saves it enabled
- **THEN** it is created on the window's server and listed with its trigger described in plain words and its next run time

#### Scenario: Run now

- **WHEN** a user runs a scheduled automation now
- **THEN** a run starts at once, is logged as started by a user, and its tab opens in front

#### Scenario: Two windows showing different servers

- **WHEN** two windows show different servers and each server has automations
- **THEN** each window's section lists only its own server's automations and offers no control for choosing a server

#### Scenario: Opening an automation leaves the list

- **WHEN** a user activates an automation in the list
- **THEN** that automation's tab opens in front and the Automations tab is still open, showing the list, behind it

## REMOVED Requirements

### Requirement: Automations section

**Reason**: Its text and one of its scenarios describe a server selector for a window holding several servers, and a window shows one server.

**Migration**: Restated for one server per window as "Automations list".
