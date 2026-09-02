## ADDED Requirements

### Requirement: Shell settings page
The Shell settings page SHALL present a default-profile selector, a **New
terminals start in** working-directory policy control, and a profile catalogue
grouped into System default, discovered, and custom entries. It SHALL identify
the connected server whose profiles are shown and state that a profile executes
its program on that server.

#### Scenario: Opening Shell settings
- **WHEN** a user opens Shell settings on a connected server
- **THEN** the page shows the server identity, the default-profile selector, the
  working-directory policy control, and the grouped catalogue, and shows no raw
  program or argument fields

#### Scenario: Two servers
- **WHEN** clients are connected to two different servers
- **THEN** each shows only its own server's profiles and defaults and cannot
  select the other server's paths

### Requirement: Profile manager and editor
The profile editor SHALL support name, structured target, startup mode, ordered
arguments, environment overlay, icon, and colour, and SHALL keep advanced
executable and environment controls in a separate area that describes their
server-side execution boundary. It SHALL support create, copy of a discovered
profile, rename, reorder, validation, reference inspection, and deletion of an
unreferenced profile, reporting revision conflicts and field-level errors
inline while preserving user input.

#### Scenario: Editing arguments and environment
- **WHEN** a user edits argument rows and environment rows
- **THEN** the values are entered as structured rows without quoting or JSON

#### Scenario: Deleting a referenced profile
- **WHEN** a user attempts to delete a profile referenced by a server or project
  default
- **THEN** the deletion is refused and each reference that must first be
  reassigned is identified

#### Scenario: Stale revision
- **WHEN** a save is submitted against a stale profile revision
- **THEN** the editor reports the conflict inline and preserves the user's input

#### Scenario: Unavailable custom profile
- **WHEN** a custom profile's target is unavailable on the server
- **THEN** the profile is retained and shown as unavailable so it can be
  repaired

### Requirement: Default selectors and discovered-profile actions
Durable default selectors SHALL offer only durable profiles. A discovered entry
SHALL be offered through **Use once** and **Copy to custom profile** actions
instead. Project editing SHALL offer a project-default profile selector
including **Use server default** and an unavailable state.

#### Scenario: Discovered shell in a default selector
- **WHEN** a user opens a server or project default selector
- **THEN** runtime-only discovered entries are not selectable, and **Use once**
  and **Copy to custom profile** are offered from the catalogue instead

#### Scenario: Project uses the server default
- **WHEN** a project's profile is set to **Use server default**
- **THEN** new terminals in that project resolve the current server default

### Requirement: New Terminal actions and splits
A **New Terminal with Profile…** action SHALL be available from the Command Bar
and the relevant tab and add menus, and SHALL make a one-time profile-id choice
for that terminal only. Ordinary new-terminal and split actions SHALL use the
canonical resolved defaults. Launch errors SHALL be displayed inline and bounded.

#### Scenario: One-off launch
- **WHEN** a user launches a terminal through **New Terminal with Profile…**
- **THEN** that terminal uses the chosen profile and no server or project
  default is changed

#### Scenario: Launch failure
- **WHEN** a launch fails
- **THEN** a bounded error is shown inline on the invoking surface

### Requirement: Session metadata retention and environment redaction
Profile catalogue and settings responses SHALL redact environment values. A
change to a profile or a default SHALL affect only terminals created afterwards;
an existing terminal SHALL retain its resolved session metadata.

#### Scenario: Profile renamed while a terminal is open
- **WHEN** a profile is renamed, edited, or made the default while a terminal
  created from it is open
- **THEN** that terminal's label, process, working directory, recording
  metadata, and session identity are unchanged

#### Scenario: Catalogue response inspected
- **WHEN** a client receives the profile catalogue
- **THEN** environment values are redacted

### Requirement: Legacy shell settings migration
Legacy raw shell program and argument fields SHALL NOT be a production
configuration path. A bounded reader SHALL migrate previously stored legacy
settings into profiles for the supported migration window only.

#### Scenario: Existing legacy configuration
- **WHEN** a server holds legacy shell settings from before this change
- **THEN** the bounded reader migrates them into a profile and the raw fields
  are not presented for editing

### Requirement: Settings clarity, accessibility, and validation
The shell settings surfaces SHALL provide searchable labels, full keyboard
operation, managed focus, announced validation, and defined narrow-layout
behaviour, with the same behaviour in native settings windows and in-page
browser settings.

#### Scenario: Keyboard-only operation
- **WHEN** a user navigates the catalogue, editor, reordering, default
  reassignment, guarded deletion, and the one-off chooser with the keyboard only
- **THEN** every action is reachable and validation results are announced

#### Scenario: Narrow layout
- **WHEN** the settings surface is displayed at a narrow width
- **THEN** the catalogue and editor remain operable with the same actions
