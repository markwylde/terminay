# macros Specification

## Purpose

Macros are reusable terminal automation recipes made from ordered execution steps and optional user-supplied fields, launched from the Command bar and executed by the selected Terminay Server against an exact terminal.

## Requirements

### Requirement: Macro composition and launch flow

A macro SHALL consist of ordered execution steps and optional user-supplied fields. Users SHALL launch macros from the Command bar, supply any required field values, preview the rendered output, and then have the rendered steps typed into the active terminal.

#### Scenario: Launching a macro with fields

- **WHEN** a user launches a macro that declares fields from the Command bar
- **THEN** the client opens a parameter modal, and the rendered steps are typed into the active terminal only after the user submits the form

#### Scenario: Launching a macro without fields

- **WHEN** a user launches a macro that declares no fields
- **THEN** the macro executes without a parameter modal and its rendered steps are typed into the active terminal

### Requirement: Server ownership of macro execution

Macro definitions, categories, normalization, execution scheduling, and inactivity waits SHALL live in the selected Terminay Server. The client SHALL edit macros and show a preview only. Macro commands SHALL be authorized against the exact target terminal and project.

#### Scenario: Client requests execution

- **WHEN** a client submits a macro run
- **THEN** the server authorizes the command against the exact target terminal and project before any PTY write

#### Scenario: Client edits a macro

- **WHEN** a user edits a macro in the client
- **THEN** the client renders a preview and writes nothing to a PTY

### Requirement: Eta template syntax for type steps

Type steps SHALL support Eta templates configured for plain terminal text. Eta tags such as `<% if (message === 'one') { %>...<% } %>` SHALL control output and interpolations such as `<%= message %>` SHALL insert values. Field names SHALL be available as top-level identifiers so a user writes `message` rather than `it.message`. XML escaping SHALL be disabled because macro output is terminal input. `{{Field Name}}` placeholders SHALL also render.

#### Scenario: Interpolating a field

- **WHEN** a type step contains `<%= message %>` and the `message` field has a value
- **THEN** the rendered step contains that value without XML escaping

#### Scenario: Brace placeholder

- **WHEN** a type step contains a `{{Field Name}}` placeholder
- **THEN** the placeholder renders from the matching field value

### Requirement: Template rendering is a data-only subset

Server execution SHALL treat Eta as a data-only subset supporting field interpolations and literal equality branches. Arbitrary JavaScript tags SHALL be rejected, and an unsupported tag SHALL fail before any PTY write, so template rendering is not a server process or code execution boundary.

#### Scenario: Unsupported template tag

- **WHEN** a macro step contains an Eta tag outside the supported data-only subset
- **THEN** rendering fails before any bytes are written to the target terminal

#### Scenario: Literal equality branch

- **WHEN** a macro step branches on a literal equality comparison of a field value
- **THEN** the branch is evaluated and the selected output is rendered

### Requirement: Just-in-time rendering of type steps

Terminay Server SHALL render each `type` step immediately before writing it to the target terminal.

#### Scenario: Multi-step macro

- **WHEN** a macro with several `type` steps executes
- **THEN** each step is rendered immediately before its own write rather than all steps being rendered up front

### Requirement: Wait step durations in seconds

Wait steps SHALL store user-facing durations in seconds through `durationSeconds`. Runtime execution SHALL render the duration and convert it to milliseconds only when scheduling the delay or inactivity timer. Saved `durationMs` values SHALL be normalized to seconds.

#### Scenario: Scheduling a wait

- **WHEN** a wait step with `durationSeconds` is executed
- **THEN** the duration is rendered and converted to milliseconds only at the point of scheduling the delay or inactivity timer

#### Scenario: Normalizing a millisecond duration

- **WHEN** a stored macro carries a `durationMs` wait value
- **THEN** normalization converts it to a `durationSeconds` value

### Requirement: Macro field types and modal behaviour

Macro fields SHALL be stored on the macro definition and keyed by `field.name`. The supported field types SHALL be `text`, `textarea`, `select`, `number`, `checkbox`, `emoji`, and `file`. The parameter modal SHALL initialize each field from `defaultValue`, validate required fields before execution, render a live preview, and execute only on submit.

#### Scenario: Opening the parameter modal

- **WHEN** the parameter modal opens for a macro
- **THEN** each field is initialized from its `defaultValue` and a live preview of the rendered output is shown

#### Scenario: Missing required field

- **WHEN** the user submits the modal with a required field empty
- **THEN** validation fails and the macro does not execute

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

### Requirement: Select option editing and validation

Select options SHALL be edited as raw textarea text, and the editor SHALL NOT parse or rewrite that text on each keystroke because incomplete input such as `First|` is valid while typing. On save, each non-empty line SHALL be either `label|value` or a single label; `label|value` lines SHALL include both sides; duplicate values SHALL be rejected; a select field SHALL have at least one option; and a default value that does not match a saved option SHALL be reset to the first option value. Parsed options SHALL be persisted as `{ label, value }[]` and transient raw editor text SHALL NOT be persisted.

#### Scenario: Typing incomplete option text

- **WHEN** the user has typed `First|` into the select options textarea
- **THEN** the editor leaves the raw text unchanged and does not rewrite or reformat it

#### Scenario: Duplicate option values

- **WHEN** a select field is saved with two lines that produce the same value
- **THEN** the save is rejected

#### Scenario: Select field with no options

- **WHEN** a select field is saved with no non-empty option lines
- **THEN** the save is rejected

#### Scenario: Default no longer matches an option

- **WHEN** a select field is saved and its existing default value matches none of the saved options
- **THEN** the default is reset to the first option's value

#### Scenario: Persisting options

- **WHEN** a select field is saved
- **THEN** the parsed `{ label, value }` pairs are persisted and the raw editor text is not

### Requirement: Server-owned revisioned macro persistence

Macros SHALL be server-owned, revisioned state loaded, normalized, saved, reset, and executed through the application protocol. Normalization SHALL preserve explicit field definitions, normalize values by type, migrate template-only macros into step-based macros, and derive compatibility fields from the step list. The macro repository SHALL own normalized revisioned definitions and explicit reset, upsert, and remove commands.

#### Scenario: Saving a macro

- **WHEN** a client saves a macro through the application protocol
- **THEN** the server normalizes and stores it as a new revision

#### Scenario: Template-only macro

- **WHEN** a stored macro carries only a template rather than steps
- **THEN** normalization produces an equivalent step-based macro

#### Scenario: Resetting macros

- **WHEN** a client issues the reset command
- **THEN** the repository restores its default macro definitions

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

### Requirement: Clipboard paste step is rejected

A clipboard `paste` step SHALL be rejected until a server-authorized clipboard boundary is provided, and SHALL never be silently delegated to a client.

#### Scenario: Macro containing a paste step

- **WHEN** a macro run reaches a clipboard `paste` step
- **THEN** the step is rejected and the operation is not delegated to a client

### Requirement: Launching-client disconnect policy

Each run SHALL record a launching-client policy. The `cancel` policy SHALL be the default and SHALL abort the run when the launching client disconnects. The `continue` policy SHALL leave the server-owned run alive and independent of the transport.

#### Scenario: Default policy on disconnect

- **WHEN** the launching client disconnects during a run recorded with the default `cancel` policy
- **THEN** the run is aborted

#### Scenario: Continue policy on disconnect

- **WHEN** the launching client disconnects during a run recorded with the `continue` policy
- **THEN** the server-owned run continues to completion independently of that transport

### Requirement: Macro run queue

Finished macro runs SHALL remain visible in the run queue until the user clears them.

#### Scenario: Clearing finished runs

- **WHEN** the user clears finished runs from the macro queue
- **THEN** those completed entries are removed from the queue

### Requirement: Macro writes follow the terminal's server

Macro terminal writes SHALL follow the terminal's canonical server, and file fields SHALL browse through that server's filesystem. A path SHALL never be read from a filesystem other than the one belonging to the server that owns the terminal.

#### Scenario: File field browsing

- **WHEN** a macro file field is used on a terminal
- **THEN** the field browses through the filesystem of the server that owns that terminal

#### Scenario: Writes reach the owning server

- **WHEN** a macro types its rendered steps into a terminal
- **THEN** the write goes to the server that owns that terminal
- **AND** the operation never falls back to another machine

### Requirement: Macros surface selects a server

The Macros surface SHALL carry a server selector listing every attached
connection, defaulting to the server that owns the active project tab. It SHALL
list, create, edit, run, and delete only macros of the selected server, and SHALL
NEVER present two servers' macros as one list. Selecting a connection that is
unavailable or incompatible SHALL show that connection's state instead of macros.

#### Scenario: Default selection

- **WHEN** the user opens Macros while a project of an attached server is active
- **THEN** the selector starts on that server and lists that server's macros

#### Scenario: Macros are not merged

- **WHEN** two attached servers each hold macros
- **THEN** the surface shows only the selected server's macros and no combined list

#### Scenario: Editing applies to one server

- **WHEN** the user creates, edits, or deletes a macro
- **THEN** the command is sent only to the selected server

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

A macro SHALL belong to at most one category. Categories SHALL be an ordered list of unique, non-empty names owned by the selected Terminay Server as part of revisioned macro state, and a category SHALL persist while it holds no macro. The Macros window SHALL let the user create a category, rename it, remove it, assign a macro to a category or to none from the macro's editor, and move a macro into a category by dragging it onto that category. Renaming a category SHALL keep its macros in it. Removing a category SHALL keep its macros and leave them without a category. Dragging a macro onto another macro SHALL place it immediately before that macro and in that macro's category, and macro order SHALL be saved. Each category SHALL offer a drag handle, and dragging a category SHALL move it above the category it is dropped on the upper half of and below the one it is dropped on the lower half of; the handle SHALL also move the category one place with Alt+Arrow Up and Alt+Arrow Down. Category order SHALL be saved, and macros without a category SHALL always be listed after every category.

A macro whose stored category is not in the category list SHALL be treated as having no category. A macro state command that carries no category list SHALL leave the stored category list unchanged.

#### Scenario: Creating a category from the editor

- **WHEN** the user chooses to add a new category in a macro's category control and names it
- **THEN** the category exists and the macro belongs to it

#### Scenario: Moving a macro by dragging

- **WHEN** the user drags a macro onto another category in the library
- **THEN** the macro belongs to that category

#### Scenario: Reordering categories by dragging

- **WHEN** the user drags the third category onto the upper half of the first and saves
- **THEN** it is the first category in the library after the window is reopened

#### Scenario: Reordering a category from the keyboard

- **WHEN** the user focuses a category's handle and presses Alt+Arrow Up
- **THEN** the category moves up one place and the handle keeps focus

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

The Macros window SHALL list the macros of the window's server grouped by category, in category order, followed by the macros that have no category. It SHALL offer a filter that matches a macro's name, description, category, and script text, and while a filter is active it SHALL show only the groups that hold a match. Each macro with unsaved changes SHALL be marked in the list. A category's actions and handle SHALL appear when its header is hovered or focused without changing the position or size of any row in the list.

#### Scenario: Filtering by script text

- **WHEN** the user types a word that appears only inside one macro's script
- **THEN** only that macro and its category are listed

#### Scenario: Hovering a category

- **WHEN** the pointer moves over a category header
- **THEN** its actions and handle are shown and every header and macro in the list stays where it was

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

#### Scenario: Category order changed

- **WHEN** the user reorders the categories in the Macros window and saves
- **THEN** the Command Bar lists the macro groups in the new order

#### Scenario: Searching

- **WHEN** the user types a query that matches macros in one category only
- **THEN** only that category's group is shown among the macro groups
