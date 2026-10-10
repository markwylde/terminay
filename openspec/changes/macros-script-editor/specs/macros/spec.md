## ADDED Requirements

### Requirement: Macro script editor

The Macros window SHALL edit a macro as one script document. Text in the document SHALL be the text typed into the terminal, and each non-text step — a key press, a fixed wait, a wait until the terminal is quiet, and selecting the current line — SHALL appear as a token placed in the document. The order of text and tokens in the document SHALL be the order in which the saved steps run: each run of text between tokens is one `type` step and each token is one step of its own kind. A token SHALL expose its own setting in place: the key for a key press, and the duration in seconds for either wait.

Typing `/` at the start of a line SHALL open a menu of the steps that can be inserted, narrowed by the characters typed after the slash, operable with the arrow keys, and confirmed with Enter or Tab. Choosing an entry SHALL replace that line with the token. When the characters typed after the slash match no step, or the user presses Escape, the menu SHALL close and the line SHALL remain literal text. The same steps SHALL also be insertable from controls beside the editor without using the keyboard, and one of those controls SHALL insert an input placeholder. A token SHALL be removable from the token itself and by pressing Backspace at the start of the text that follows it.

The editor SHALL highlight `{{Field}}` placeholders and Eta tags in the text. Whether a macro ends by pressing Enter SHALL be expressed only by a key-press token in the script.

#### Scenario: A prompt is only text

- **WHEN** the user types a prompt into an empty macro and saves
- **THEN** the macro is saved with a single `type` step holding that text

#### Scenario: Inserting a step with a slash

- **WHEN** the user types `/` at the start of a line and confirms "Wait until quiet"
- **THEN** that line becomes a wait-until-quiet token and the cursor continues on the line after it

#### Scenario: A slash command stays text

- **WHEN** the user types `/opsx:apply` at the start of a line
- **THEN** the step menu closes once no step matches and the line is saved as literal text

#### Scenario: Document order is run order

- **WHEN** a script holds text, then an Enter token, then a one-second wait token, then more text
- **THEN** the saved steps are a `type` step, a `key` step, a `wait_time` step, and a `type` step in that order

#### Scenario: Removing a token

- **WHEN** the user presses Backspace at the start of the text following a token
- **THEN** the token is removed and the text before and after it remain

#### Scenario: Ending without Enter

- **WHEN** a script's last element is text
- **THEN** the macro leaves that text on the terminal's command line without submitting it

### Requirement: Unsupported steps are preserved and never run

A macro step whose type is not one the server executes SHALL be preserved in the stored definition as an unsupported step and SHALL NOT prevent the macro library from loading or the macro from being saved. A run of a macro that contains an unsupported step SHALL be rejected as an invalid macro before any byte is written to the target terminal, with an error that names the macro. The Macros window SHALL show an unsupported step in the script as a token that says it cannot run and that the user can remove; removing every unsupported step SHALL make the macro runnable.

#### Scenario: Loading a library with an unsupported step

- **WHEN** stored macro state contains a macro with a step type the server does not execute
- **THEN** the library loads, and that macro is listed with the step preserved as unsupported

#### Scenario: Running a macro with an unsupported step

- **WHEN** a user launches a macro that contains an unsupported step
- **THEN** the run is rejected as an invalid macro and nothing is written to the terminal

#### Scenario: Removing the unsupported step

- **WHEN** the user removes the unsupported token from the script and saves
- **THEN** the macro runs normally

### Requirement: Macro categories

A macro SHALL belong to at most one category. Categories SHALL be an ordered list of unique, non-empty names owned by the selected Terminay Server as part of revisioned macro state, and a category SHALL persist while it holds no macro. The Macros window SHALL let the user create a category, rename it, remove it, assign a macro to a category or to none from the macro's editor, and move a macro into a category by dragging it onto that category. Renaming a category SHALL keep its macros in it. Removing a category SHALL keep its macros and leave them without a category. Dragging a macro onto another macro SHALL place it immediately before that macro and in that macro's category, and macro order SHALL be saved.

A macro whose stored category is not in the category list SHALL be treated as having no category. A macro state command that carries no category list SHALL leave the stored category list unchanged.

#### Scenario: Creating a category from the editor

- **WHEN** the user chooses to add a new category in a macro's category control and names it
- **THEN** the category exists and the macro belongs to it

#### Scenario: Moving a macro by dragging

- **WHEN** the user drags a macro onto another category in the library
- **THEN** the macro belongs to that category

#### Scenario: Removing a category

- **WHEN** the user removes a category that holds macros
- **THEN** the category is gone and its macros remain, without a category

#### Scenario: An empty category persists

- **WHEN** the user creates a category, assigns nothing to it, and saves
- **THEN** the category is still listed after the window is reopened

#### Scenario: A command without categories

- **WHEN** a client that sends no category list replaces the macro definitions
- **THEN** the server keeps its stored category list

### Requirement: Macros window library

The Macros window SHALL list the macros of the window's server grouped by category, in category order, followed by the macros that have no category. It SHALL offer a filter that matches a macro's name, description, category, and script text, and while a filter is active it SHALL show only the groups that hold a match. Each macro with unsaved changes SHALL be marked in the list.

#### Scenario: Filtering by script text

- **WHEN** the user types a word that appears only inside one macro's script
- **THEN** only that macro and its category are listed

#### Scenario: Unsaved marker

- **WHEN** the user edits a macro and selects a different one without saving
- **THEN** the edited macro is marked as unsaved in the list and its edits are retained

### Requirement: Window-level save

The Macros window SHALL hold edits to every macro and to the category list as one pending change set. It SHALL state when there are unsaved changes and to how many macros, and SHALL offer one Save that applies the whole set to the server and one Discard that restores the last saved state. Save SHALL be available from the keyboard. A rejected save SHALL leave the pending edits in place and SHALL state why it was rejected.

#### Scenario: Saving several macros

- **WHEN** the user edits two macros and saves once
- **THEN** both macros are stored and the window reports no unsaved changes

#### Scenario: Discarding

- **WHEN** the user edits a macro and a category and chooses Discard
- **THEN** the macro and the category list return to their last saved state

#### Scenario: Rejected save

- **WHEN** a save is rejected because a select input has no options
- **THEN** the edits remain, and the window states which input is invalid

### Requirement: Live macro preview

The Macros window SHALL show, beside the editor, a preview of the selected macro made of the form the user will be asked when the macro is launched and the sequence that will be sent to the terminal. The form SHALL contain one control per input, initialized from the input's default, and the sequence SHALL be rendered with the values currently in that form, listing each step in run order. The preview SHALL update as the script, the inputs, or the form values change. An input with no value SHALL be shown in the sequence by its label rather than as empty text. The preview SHALL NOT write to any terminal.

#### Scenario: Preview follows the script

- **WHEN** the user adds a wait token to the script
- **THEN** the preview sequence shows the wait at that position without a save

#### Scenario: Preview follows a form value

- **WHEN** the user changes a value in the preview form
- **THEN** the sequence shows the text rendered with that value

#### Scenario: Macro without inputs

- **WHEN** the selected macro declares no inputs
- **THEN** the preview states that the macro runs without asking anything

### Requirement: File field input methods

A file field SHALL accept a path in three ways wherever it is shown: typed or edited as text; pasted as a path, as a `file:` URL, or as a copied file; and supplied by dragging a file onto the field. A `file:` URL SHALL be converted to its path. A dropped or pasted file SHALL supply its path on the same terms as a file dropped on a terminal, and where the host cannot resolve a path for it the field SHALL say so and leave its value unchanged. The field SHALL show that it is a drop target while a file is dragged over it. Accepting a path by any of these methods SHALL NOT read the file.

#### Scenario: Dropping a file

- **WHEN** the user drags a file onto a file field on a host that resolves dropped file paths
- **THEN** the field's value becomes that file's path

#### Scenario: Pasting a file URL

- **WHEN** the user pastes `file:///Users/sam/notes%20a.md` into a file field
- **THEN** the field's value becomes `/Users/sam/notes a.md`

#### Scenario: Typing a path

- **WHEN** the user types a path into a file field
- **THEN** the field's value is the typed text

#### Scenario: Host cannot resolve a dropped file

- **WHEN** the user drops a file onto a file field on a host that cannot resolve a path for it
- **THEN** the field says the path is unavailable and its value is unchanged

### Requirement: Command Bar groups macros by category

The Command Bar SHALL present saved macros in one group per category, titled with the category name, in category order, and SHALL present macros that have no category in a group titled Macros. Within a group, macros SHALL keep their saved order. A category that holds no matching macro SHALL NOT be shown.

#### Scenario: Opening the Command Bar

- **WHEN** the user opens the Command Bar and macros exist in two categories and in none
- **THEN** each category is a group in category order, followed by a Macros group holding the uncategorised macros

#### Scenario: Searching

- **WHEN** the user types a query that matches macros in one category only
- **THEN** only that category's group is shown among the macro groups

## MODIFIED Requirements

### Requirement: Server ownership of macro execution

Macro definitions, categories, normalization, execution scheduling, and inactivity waits SHALL live in the selected Terminay Server. The client SHALL edit macros and show a preview only. Macro commands SHALL be authorized against the exact target terminal and project.

#### Scenario: Client requests execution

- **WHEN** a client submits a macro run
- **THEN** the server authorizes the command against the exact target terminal and project before any PTY write

#### Scenario: Client edits a macro

- **WHEN** a user edits a macro in the client
- **THEN** the client renders a preview and writes nothing to a PTY

### Requirement: Field detection from steps

The Macros window SHALL detect inputs from the script as it is edited: `{{Field}}` placeholders and common Eta identifiers inside template tags in text, and single-brace fields such as `{Delay}` in wait durations. A detected name that has no input SHALL gain one immediately, with a label derived from the name, the text type, and required set. Inputs SHALL be edited in a labelled table of name, label shown when run, type, default, and required. An input the user has not edited SHALL be removed when the script no longer references it. An input the user has edited SHALL be preserved when the script no longer references it, SHALL be marked as unused, and SHALL be removable by the user. Explicit inputs SHALL be preserved on save even when no step references them.

#### Scenario: Syncing fields from steps

- **WHEN** the user types `{{Name}}` and an Eta identifier into the script
- **THEN** an input for each appears in the inputs table without any further action

#### Scenario: Wait duration field

- **WHEN** a wait token's duration is set to a single-brace field such as `{Delay}`
- **THEN** an input for that duration appears

#### Scenario: Untouched input no longer referenced

- **WHEN** the user deletes the only reference to an input they have not edited
- **THEN** the input is removed

#### Scenario: Edited input no longer referenced

- **WHEN** the user deletes the only reference to an input whose label they changed
- **THEN** the input remains, marked as unused, until the user removes it

#### Scenario: Explicit field not referenced by any step

- **WHEN** a macro with an explicitly defined field that no step references is saved
- **THEN** that field is preserved

### Requirement: Bounded macro run execution

The macro runner SHALL execute bounded steps against an exact server, project, and session target, including time and inactivity waits, cancellation, and output and concurrency limits. A macro run SHALL NOT read the server vault.

#### Scenario: Executing a run

- **WHEN** a macro run starts
- **THEN** its steps execute against the exact server, project, and session target under the configured output and concurrency limits

#### Scenario: Cancelling a run

- **WHEN** a running macro is cancelled
- **THEN** its remaining steps do not execute

#### Scenario: Macro run and the vault

- **WHEN** a macro run executes any step
- **THEN** no vault entry is read on behalf of that run

## REMOVED Requirements

### Requirement: Macro step editor

**Reason**: The step list and its multi-line text modal are replaced by the script editor, in which a macro is one document and multi-line text needs no separate editor.

**Migration**: See "Macro script editor". Template highlighting moves into the script editor. `Cmd/Ctrl+Enter` and `Escape` no longer apply or cancel a modal; the window's Save applies edits and Discard reverts them. Saved macros need no conversion: their steps open as text and tokens.

### Requirement: Secret interpolation stays inside the server vault boundary

**Reason**: A secret step writes the secret into the terminal, where the agent or program running there reads it as ordinary input. The feature cannot keep a value from an agent, which was its purpose, so macros carry no secrets.

**Migration**: Remove secret steps from saved macros; a macro that still holds one is preserved and does not run (see "Unsupported steps are preserved and never run"). Secrets previously saved through the Macros window are no longer listed or used. Desktop's `secrets.json` in the application data directory is left in place and is not read; delete it by hand to remove the stored values. Supply a credential to a program through that program's own configuration or the shell environment.
