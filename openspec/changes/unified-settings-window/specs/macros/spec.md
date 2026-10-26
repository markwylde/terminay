## RENAMED Requirements

- FROM: `### Requirement: Macros window library`
- TO: `### Requirement: Macros library`

- FROM: `### Requirement: Window-level save`
- TO: `### Requirement: Macros change set`

## MODIFIED Requirements

### Requirement: Macros surface selects a server

The Macros category of Settings SHALL use the Settings server selector, which lists every attached connection and defaults to the server that owns the active project tab. It SHALL list, create, edit, run, and delete only macros of the selected server, and SHALL NEVER present two servers' macros as one list. Selecting a connection that is unavailable or incompatible SHALL show that connection's state instead of macros.

#### Scenario: Default selection

- **WHEN** the user opens Settings at Macros while a project of an attached server is active
- **THEN** the selector starts on that server and lists that server's macros

#### Scenario: Macros are not merged

- **WHEN** two attached servers each hold macros
- **THEN** the Macros category shows only the selected server's macros and no combined list

#### Scenario: Editing applies to one server

- **WHEN** the user creates, edits, or deletes a macro
- **THEN** the command is sent only to the selected server

### Requirement: Macros library

The Macros category of Settings SHALL show the macros of the selected server in its list column, grouped by category, in category order, followed by the macros that have no category. The list column SHALL offer a filter that matches a macro's name, description, category, and script text, and while a filter is active it SHALL show only the groups that hold a match. Each macro with unsaved changes SHALL be marked in the list. A category's actions and handle SHALL appear when its header is hovered or focused without changing the position or size of any row in the list. Selecting a macro SHALL show its editor and preview in the detail pane, and **New macro** in the list column header SHALL create a macro and select it.

#### Scenario: Filtering by script text

- **WHEN** the user types a word that appears only inside one macro's script
- **THEN** only that macro and its category are listed

#### Scenario: Hovering a category

- **WHEN** the pointer moves over a category header
- **THEN** its actions and handle are shown and every header and macro in the list stays where it was

#### Scenario: Unsaved marker

- **WHEN** the user edits a macro and selects a different one without saving
- **THEN** the edited macro is marked as unsaved in the list and its edits are retained

#### Scenario: Selecting a macro

- **WHEN** the user selects a macro in the list column
- **THEN** the detail pane shows that macro's script editor and live preview

### Requirement: Macros change set

The Macros category SHALL hold edits to every macro and to the category list as one pending change set, apart from the settings that Settings saves as they change. It SHALL state when there are unsaved changes and to how many macros, and SHALL offer one Save that applies the whole set to the server and one Discard that restores the last saved state. Save SHALL be available from the keyboard. A rejected save SHALL leave the pending edits in place and SHALL state why it was rejected. Pending edits SHALL survive moving to another Settings category and back. Closing Settings or switching the selected server while edits are pending SHALL ask whether to save or discard them, or to keep editing.

#### Scenario: Saving several macros

- **WHEN** the user edits two macros and saves once
- **THEN** both macros are stored and the Macros category reports no unsaved changes

#### Scenario: Discarding

- **WHEN** the user edits a macro and a category and chooses Discard
- **THEN** the macro and the category list return to their last saved state

#### Scenario: Rejected save

- **WHEN** a save is rejected because a select input has no options
- **THEN** the edits remain, and the Macros category states which input is invalid

#### Scenario: Leaving the category with pending edits

- **WHEN** the user edits a macro, opens Appearance, and returns to Macros
- **THEN** the edit is still pending and the macro is still marked as unsaved

#### Scenario: Closing Settings with pending edits

- **WHEN** the user closes Settings while macro edits are pending
- **THEN** Settings asks whether to save, discard, or keep editing, and closes only after save or discard

### Requirement: Field detection from steps

The macro editor in Settings SHALL detect inputs from the script as it is edited: `{{Field}}` placeholders and common Eta identifiers inside template tags in text, and single-brace fields such as `{Delay}` in wait durations. A detected name that has no input SHALL gain one immediately, with a label derived from the name, the text type, and required set. Inputs SHALL be edited in a labelled table of name, label shown when run, type, default, and required. An input the user has not edited SHALL be removed when the script no longer references it. An input the user has edited SHALL be preserved when the script no longer references it, SHALL be marked as unused, and SHALL be removable by the user. Explicit inputs SHALL be preserved on save even when no step references them.

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

### Requirement: Macro script editor

The macro editor in Settings SHALL edit a macro as one script document. Text in the document SHALL be the text typed into the terminal, and each non-text step — a key press, a fixed wait, a wait until the terminal is quiet, and selecting the current line — SHALL appear as a token placed in the document. The order of text and tokens in the document SHALL be the order in which the saved steps run: each run of text between tokens is one `type` step and each token is one step of its own kind. A token SHALL expose its own setting in place: the key for a key press, and the duration in seconds for either wait.

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

A macro step whose type is not one the server executes SHALL be preserved in the stored definition as an unsupported step and SHALL NOT prevent the macro library from loading or the macro from being saved. A run of a macro that contains an unsupported step SHALL be rejected as an invalid macro before any byte is written to the target terminal, with an error that names the macro. The macro editor in Settings SHALL show an unsupported step in the script as a token that says it cannot run and that the user can remove; removing every unsupported step SHALL make the macro runnable.

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

A macro SHALL belong to at most one category. Categories SHALL be an ordered list of unique, non-empty names owned by the selected Terminay Server as part of revisioned macro state, and a category SHALL persist while it holds no macro. The Macros category of Settings SHALL let the user create a category, rename it, remove it, assign a macro to a category or to none from the macro's editor, and move a macro into a category by dragging it onto that category. Renaming a category SHALL keep its macros in it. Removing a category SHALL keep its macros and leave them without a category. Dragging a macro onto another macro SHALL place it immediately before that macro and in that macro's category, and macro order SHALL be saved. Each category SHALL offer a drag handle, and dragging a category SHALL move it above the category it is dropped on the upper half of and below the one it is dropped on the lower half of; the handle SHALL also move the category one place with Alt+Arrow Up and Alt+Arrow Down. Category order SHALL be saved, and macros without a category SHALL always be listed after every category.

A macro whose stored category is not in the category list SHALL be treated as having no category. A macro state command that carries no category list SHALL leave the stored category list unchanged.

#### Scenario: Creating a category from the editor

- **WHEN** the user chooses to add a new category in a macro's category control and names it
- **THEN** the category exists and the macro belongs to it

#### Scenario: Moving a macro by dragging

- **WHEN** the user drags a macro onto another category in the library
- **THEN** the macro belongs to that category

#### Scenario: Reordering categories by dragging

- **WHEN** the user drags the third category onto the upper half of the first and saves
- **THEN** it is the first category in the library after Settings is reopened

#### Scenario: Reordering a category from the keyboard

- **WHEN** the user focuses a category's handle and presses Alt+Arrow Up
- **THEN** the category moves up one place and the handle keeps focus

#### Scenario: Removing a category

- **WHEN** the user removes a category that holds macros
- **THEN** the category is gone and its macros remain, without a category

#### Scenario: An empty category persists

- **WHEN** the user creates a category, assigns nothing to it, and saves
- **THEN** the category is still listed after Settings is reopened

#### Scenario: A command without categories

- **WHEN** a client that sends no category list replaces the macro definitions
- **THEN** the server keeps its stored category list

### Requirement: Live macro preview

The Macros category SHALL show, beside the editor in the detail pane, a preview of the selected macro made of the form the user will be asked when the macro is launched and the sequence that will be sent to the terminal. The form SHALL contain one control per input, initialized from the input's default, and the sequence SHALL be rendered with the values currently in that form, listing each step in run order. The preview SHALL update as the script, the inputs, or the form values change. An input with no value SHALL be shown in the sequence by its label rather than as empty text. The preview SHALL NOT write to any terminal.

#### Scenario: Preview follows the script

- **WHEN** the user adds a wait token to the script
- **THEN** the preview sequence shows the wait at that position without a save

#### Scenario: Preview follows a form value

- **WHEN** the user changes a value in the preview form
- **THEN** the sequence shows the text rendered with that value

#### Scenario: Macro without inputs

- **WHEN** the selected macro declares no inputs
- **THEN** the preview states that the macro runs without asking anything

### Requirement: Command Bar groups macros by category

The Command Bar SHALL present saved macros in one group per category, titled with the category name, in category order, and SHALL present macros that have no category in a group titled Macros. Within a group, macros SHALL keep their saved order. A category that holds no matching macro SHALL NOT be shown.

#### Scenario: Opening the Command Bar

- **WHEN** the user opens the Command Bar and macros exist in two categories and in none
- **THEN** each category is a group in category order, followed by a Macros group holding the uncategorised macros

#### Scenario: Category order changed

- **WHEN** the user reorders the categories in the Macros category of Settings and saves
- **THEN** the Command Bar lists the macro groups in the new order

#### Scenario: Searching

- **WHEN** the user types a query that matches macros in one category only
- **THEN** only that category's group is shown among the macro groups

