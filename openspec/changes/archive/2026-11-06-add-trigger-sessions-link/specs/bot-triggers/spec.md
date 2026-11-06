## MODIFIED Requirements

### Requirement: Trigger table and editor sheet

The Triggers tab SHALL list a bot's triggers in a table. Each row SHALL show the trigger's source, name and plain-words condition, its status, when it was last checked, its last firing, its next firing, an enable control, Run now, Sessions, and delete. Activating a row SHALL open the trigger editor as a sheet over the table. The sheet for a saved trigger SHALL also offer Sessions. Sessions SHALL open the bot's Sessions tab filtered to the sessions that trigger started, as specified by terminay-bots. Closing the sheet SHALL keep an unsaved draft for when the same trigger, or a new trigger, is opened again.

#### Scenario: A trigger that checks without firing

- **WHEN** a command trigger fires when its output starts matching, and its output keeps matching
- **THEN** its row shows a recent last check while its last firing stays at the moment it started matching

#### Scenario: Reopening a draft

- **WHEN** a user closes the sheet with unsaved changes to a new trigger and then chooses New trigger
- **THEN** the sheet opens with those changes

#### Scenario: Showing a trigger's sessions

- **WHEN** a user chooses Sessions on the row of a trigger that has fired twice and been run once with Run now
- **THEN** the Sessions tab opens listing those three sessions, with a filter control naming the trigger

#### Scenario: Sessions from the editor sheet

- **WHEN** a user chooses Sessions in the sheet of a saved trigger
- **THEN** the Sessions tab opens filtered to that trigger

#### Scenario: Triggers with the same name

- **WHEN** two triggers share a name and a user chooses Sessions on one of them
- **THEN** only the sessions of the chosen trigger are listed

#### Scenario: A new trigger has no Sessions action

- **WHEN** the sheet is open for a trigger that has not been saved
- **THEN** the sheet does not offer Sessions
