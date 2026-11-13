## ADDED Requirements

### Requirement: Import & Export is a Desktop Settings category

Settings SHALL have an **Import & Export** category in its Connections group,
offered only when the host kind is Desktop. The Terminay application menu SHALL
carry **Import & Export…** directly below **Settings…**, and the Command Bar
SHALL offer the same command. Both SHALL open or focus the Settings window at
that category. Browser hosts SHALL NOT show the category, the menu item, or the
command.

#### Scenario: Opening from the application menu

- **WHEN** a Desktop user chooses Terminay, **Import & Export…**
- **THEN** the Settings window opens or is focused with the Import & Export category selected

#### Scenario: Browser host

- **WHEN** Settings renders on a browser host
- **THEN** it has no Import & Export category and the Command Bar offers no Import & Export command

### Requirement: Sync matrix of items across attached servers

The category SHALL show a matrix with one column per attached connection, in
the window's connection order, and one row per item key, grouped by kind. The
kinds SHALL be macros, workflow templates, custom shell profiles, automations,
and portable settings categories. Each cell SHALL state its state relative to
the source column as both a glyph and a word, so the state is not carried by
colour alone. The states are **same**, **differs**, **missing**, **duplicate
name**, **not supported**, **not permitted**, and **not ready**.

#### Scenario: Item present on two of three servers

- **WHEN** a macro named "Deploy staging" exists unchanged on Local and vms but not on build-box
- **THEN** its row shows **same** under Local and vms and **missing** under build-box

#### Scenario: Same name, different content

- **WHEN** a workflow template named "Count" has four steps on the source and three on vms
- **THEN** the vms cell for "Count" shows **differs**

### Requirement: Items are matched by name and compared by portable content

An item's key SHALL be its kind and its name, trimmed and compared without
case. A settings category's name SHALL be its category id. Server-assigned ids
SHALL never identify an item across servers. Two copies SHALL be the same when
their portable content is equal. That comparison SHALL keep case. It SHALL
exclude ids, revisions, server-maintained fields, step and field ids, and an
automation's enabled state.

#### Scenario: Server-assigned ids differ

- **WHEN** two servers hold identical macros under different ids
- **THEN** the row shows **same** for both

#### Scenario: Content differs only in case

- **WHEN** two macros named "deploy" and "Deploy" type `make Build` and `make build`
- **THEN** they share one row and the cell shows **differs**

#### Scenario: Automation enabled on one server only

- **WHEN** an automation is enabled on the source and is an otherwise identical disabled copy on the target
- **THEN** the cell shows **same**

### Requirement: Column states for unavailable, unsupported, and denied data

A connection that is not ready SHALL show its state in its column header, and
its cells SHALL show **not ready**. A server that does not offer a kind's
operations SHALL show **not supported** for that kind's rows. A server that
refuses to read or write a kind for this device SHALL show **not permitted**
for those rows. A column SHALL NOT be a source or a target for rows it shows as
**not ready**, **not supported**, or **not permitted**. Where the host can
attach connections, a remembered server that this window has not attached
SHALL have a column marked **Not attached**, whose cells show **not ready**,
and that column SHALL offer **Attach**, which attaches the server to the window
as the connection menu's **Attach** does.

#### Scenario: Remembered server not attached

- **WHEN** the user has paired build-box but this window has not attached it
- **THEN** a build-box column shows **Not attached** with an **Attach** action, and after attaching it fills with build-box's items

#### Scenario: Connection offline

- **WHEN** an attached connection is unreachable
- **THEN** its column header reports that state, its cells show **not ready**, and it cannot be ticked as a target

#### Scenario: Older server without workflow templates

- **WHEN** an attached server does not offer workflow template operations
- **THEN** that column shows **not supported** on every workflow-template row

### Requirement: Duplicate names on one server

When one server holds more than one item with the same key, that cell SHALL
show **duplicate name** with the count. That column SHALL NOT be the source for
that row. A write to such a target SHALL require the user to pick which one item
**Replace** replaces.

#### Scenario: Duplicate on the source

- **WHEN** the source holds two macros named "Build"
- **THEN** the "Build" row shows **duplicate name** under the source and cannot be selected

#### Scenario: Duplicate on a target

- **WHEN** the user copies "Build" to a target holding two items named "Build" and chooses Replace
- **THEN** review asks which of the two to replace before Apply is available

### Requirement: Filtering the matrix

The matrix SHALL offer a filter chip for each kind with its row count, a text
filter that matches item names, and an **Only differences** toggle. The toggle
SHALL hide rows that are **same** in every ready column. Filtering SHALL NOT
clear rows already selected.

#### Scenario: Only differences

- **WHEN** the user turns on **Only differences**
- **THEN** rows that are **same** in every ready column are hidden and selected rows stay selected

### Requirement: Choosing source, targets, and rows

The user SHALL choose exactly one source column, and SHALL tick one or more
target columns other than the source. The source SHALL default to the server
that owns the active project tab, and to the primary connection when no project
tab is active. A row SHALL be selectable only when its source cell holds exactly
one item. Changing the source SHALL clear the row selection. The matrix SHALL
summarise how many items will go from which source to which targets, and SHALL
offer **Review** only when at least one row and one target are chosen.

#### Scenario: Default source

- **WHEN** the category opens while a project on vms is active
- **THEN** the vms column is the source

#### Scenario: No active project

- **WHEN** the category opens with no project tab active
- **THEN** the primary connection's column is the source

#### Scenario: Row missing on source

- **WHEN** an item is **missing** in the source column
- **THEN** its row cannot be selected

### Requirement: Review resolves every clash explicitly

**Review** SHALL list every planned write for each target. A write that adds an
item missing on the target SHALL need no decision. An item that is the same on a
target SHALL be listed as up to date, and nothing SHALL be written for it. For
every other item that exists on a target, review SHALL show what differs and
SHALL require a choice, with none preselected. **Apply** SHALL be unavailable
until every clash has a choice.

#### Scenario: Clash needs a decision

- **WHEN** the user reviews a copy of a macro that differs on the target
- **THEN** the review shows the difference, offers its choices with none selected, and Apply stays unavailable until one is chosen

#### Scenario: Already up to date

- **WHEN** a selected item is the same on a target
- **THEN** the review lists it as up to date and applying writes nothing for it

### Requirement: Clash choices by kind

For macros, workflow templates, custom shell profiles, and automations, the
choices SHALL be **Replace**, **Keep both**, and **Skip**. **Keep both** SHALL
add the source copy under the next free name of the form `<name> (n)`, with `n`
starting at 2. For a settings category, the choices SHALL be **Replace** and
**Skip**. Replacing a settings category SHALL set every field of that category
on the target to the source's value, so a replaced category then shows
**same**.

#### Scenario: Keep both

- **WHEN** the user chooses **Keep both** for "Count" on a target that already has "Count"
- **THEN** applying adds the source copy on the target as "Count (2)" and leaves the existing one unchanged

#### Scenario: Settings category clash

- **WHEN** the Theme category differs on a target
- **THEN** review offers Replace and Skip only, and after Replace the Theme cell shows **same**

### Requirement: Review is invalidated when connections change

An open review SHALL be discarded, and the matrix shown again, when the source
or any chosen target connection stops being ready or is detached.

#### Scenario: Target disconnects during review

- **WHEN** a chosen target goes offline while review is open
- **THEN** the review closes, the matrix shows that column as **not ready**, and nothing is written

### Requirement: Copies are written through each target's own operations

Applying SHALL write each item to each target through that target server's
existing operations for its kind, under the target's own validation and
authorization. No server SHALL send an operation to another server. Every
write SHALL carry the target revision that review read. A revision conflict
SHALL skip that write and report it as **changed since review**. Writes SHALL
proceed item by item and SHALL NOT roll back. The matrix SHALL then refresh
from each server's state.

#### Scenario: Target changed after review

- **WHEN** another client edits a target's macros between review and apply
- **THEN** the revision-guarded write is refused, the item is reported as changed since review, and the other client's edit is kept

#### Scenario: One target refuses an item

- **WHEN** a target rejects one item during apply
- **THEN** the other independent items are still written

### Requirement: Apply reports a result for each item and target

The result SHALL report, for each item and each target, one of: added,
replaced, skipped, up to date, changed since review, blocked by dependency, or
failed. A failed write SHALL show the target's error.

#### Scenario: Result names a failure

- **WHEN** a target rejects a workflow template as over its size bound
- **THEN** the result shows that template and target as failed with the target's error

### Requirement: Item kinds carry only portable content

Macros SHALL carry their title, description, category, fields, and steps.
Workflow templates SHALL carry their name, description, category, opening
prompt, and steps. Step ids SHALL be assigned by the target. A macro or template
category that the target lacks SHALL be added to it. Only custom shell profiles
SHALL be rows. A copied profile SHALL be validated on the target, and review
SHALL warn when it is unavailable there.

#### Scenario: Discovered shell profile

- **WHEN** a server has a discovered `/bin/fish` profile
- **THEN** it has no row in the matrix

#### Scenario: Missing category

- **WHEN** a macro in category "Deploy" is added to a target that has no "Deploy" category
- **THEN** the target gains the "Deploy" category and the macro is in it

### Requirement: Portable settings categories

The portable settings categories SHALL be Appearance, Theme, Cursor,
Interaction, Shortcuts, Scrolling, Accessibility, Files, and AI. A category
SHALL carry the server-owned value of every field in that category. Remote
Access, Recording, Shell, Updates, and per-project layout state SHALL NEVER be
copied.

#### Scenario: Copying a settings category

- **WHEN** the user copies the Theme category from Local to vms
- **THEN** vms receives Local's theme values and no value outside the Theme category changes on vms

### Requirement: Automations arrive disabled with named references

A copied automation SHALL be written disabled on every target, whatever its
state on the source, and review SHALL say so. An automation's macro or shell
profile reference SHALL be carried as a named reference: the kind and the name
of the referenced item. A working directory SHALL be copied as text, and review
SHALL warn that it refers to a path on the target's machine.

#### Scenario: Enabled source automation

- **WHEN** the user copies an enabled automation to a target
- **THEN** it is written disabled on the target

### Requirement: Dependencies are resolved to reviewed items

When the target lacks the item an automation references, review SHALL add that
item to the copy as a dependency and SHALL show it. When the target has the
item, the reference SHALL bind to the item that the dependency's own decision
produces: Replace binds to the replaced item, Keep both to the new copy, and
Skip or up to date to the target's existing item. A dependency that fails, is
blocked, or changed since review SHALL block the automation, which SHALL then be
reported as blocked by dependency and not written. A reference that resolves to
no item SHALL block the automation in review.

#### Scenario: Automation with a macro the target lacks

- **WHEN** the user copies an automation that runs macro "Clean worktrees" to a target without that macro
- **THEN** review adds "Clean worktrees" as a dependency, and applying writes the macro and then the disabled automation pointing at the new macro

#### Scenario: Keep both on a dependency

- **WHEN** the referenced macro differs on the target and the user chooses Keep both for it
- **THEN** the copied automation points at the new "Clean worktrees (2)", not the existing macro

#### Scenario: Dependency fails

- **WHEN** the dependency macro's write fails
- **THEN** the automation is not written and is reported as blocked by dependency

### Requirement: Secrets and literal content

Vault secrets SHALL NEVER be read, copied, or exported, because no copied kind
references the vault. Literal item content SHALL be copied exactly as stored,
including script text, field defaults, prompts, and shell-profile environment
values. Before **Export selected…** writes a file, it SHALL tell the user that
the file contains item content as plain text.

#### Scenario: Exporting a profile with environment values

- **WHEN** the user exports a shell profile that has environment values
- **THEN** the export notes that item content is written as plain text before the save dialog opens

### Requirement: Bundle file export

**Export selected…** SHALL write the selected rows from the source column, with
their dependencies, to a JSON bundle file that the user places through the
Desktop save dialog. The bundle SHALL record a format name, a format version,
the export time, the source server's label, and each item's kind, name, and
portable content, with references as named references. It SHALL NOT contain
server ids, item ids, or revisions.

#### Scenario: Exporting an automation alone

- **WHEN** the user exports only an automation that runs macro "Clean worktrees"
- **THEN** the bundle contains both the automation and "Clean worktrees"

### Requirement: Bundle file import

**Import file…** SHALL read a bundle that the user chooses and validate all of
it before showing anything. A valid bundle SHALL become a read-only column
named after the file. That column SHALL be usable as a source and never as a
target. A bundle SHALL be refused with a reason, and nothing from it shown or
written, when any of these hold:
- it is malformed;
- it has an unknown format or version;
- it is over size;
- it holds an unknown kind or a forbidden field;
- it holds two items with the same key;
- an item breaks its kind's bounds;
- a reference names no item in the bundle.

#### Scenario: Round trip

- **WHEN** the user exports three macros from Local and imports the file
- **THEN** a read-only column named after the file shows those three items as **same** as Local

#### Scenario: Invalid bundle

- **WHEN** the user imports a file that holds an item id
- **THEN** the import is refused with that reason and no column is added
