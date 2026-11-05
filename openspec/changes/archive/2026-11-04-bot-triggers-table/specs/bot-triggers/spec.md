## ADDED Requirements

### Requirement: Trigger table and editor sheet

The Triggers tab SHALL list a bot's triggers in a table. Each row SHALL show the trigger's source, name and plain-words condition, its status, when it was last checked, its last firing, its next firing, an enable control, Run now, and delete. Activating a row SHALL open the trigger editor as a sheet over the table. Closing the sheet SHALL keep an unsaved draft for when the same trigger, or a new trigger, is opened again.

#### Scenario: A trigger that checks without firing

- **WHEN** a command trigger fires when its output starts matching, and its output keeps matching
- **THEN** its row shows a recent last check while its last firing stays at the moment it started matching

#### Scenario: Reopening a draft

- **WHEN** a user closes the sheet with unsaved changes to a new trigger and then chooses New trigger
- **THEN** the sheet opens with those changes

### Requirement: Trigger validation waits for the user

The trigger editor SHALL NOT show a problem with a form the user has not edited. After an edit, a problem with the condition SHALL be shown inline in the When section. A refused save SHALL show its reason beside the save control. A preview that the server cannot compute SHALL NOT be shown as an error.

#### Scenario: Typing a match

- **WHEN** a user is part-way through typing the text to match
- **THEN** no error banner appears, and saving with an invalid condition shows the reason beside Save

### Requirement: Explicit repeat firing

For a match on text, a regular expression, or an exit code, the editor SHALL offer a choice between firing when the result starts matching and firing on every matching check, and SHALL describe each.

#### Scenario: Choosing repeat firing

- **WHEN** a user chooses On every matching check for a command whose output always matches
- **THEN** each check starts a session
