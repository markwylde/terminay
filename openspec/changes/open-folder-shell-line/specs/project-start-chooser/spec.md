## MODIFIED Requirements

### Requirement: Open a folder

**Open a folder** SHALL open a folder browser served by the project's server, in every client host, with its path field holding the server account's home directory followed by a path separator. The browser SHALL show the path once, in a single editable path field, and SHALL NOT repeat it in a separate read-only location line. The browser SHALL list the subdirectories of the folder named by the path field up to its last separator, filtered to those whose names start with the segment after that separator, ignoring case, taken from the same server browse query. Editing the field SHALL update the listing without a separate go or navigate action. Directories whose names start with `.` SHALL be listed only while the typed segment itself starts with `.`. Above the listing the browser SHALL state how many folders match and which folder is listed, or, when the typed parent is not a folder the server can list, a plain message saying so. The browser SHALL keep one height while the user moves between folders, whatever the number of entries, scrolling its listing within that height. Selecting a listed folder with the pointer SHALL put that folder followed by a separator in the path field, and double-selecting it SHALL choose it. The primary action SHALL name the folder that choosing would take, and SHALL be unavailable when the field names no folder. Choosing a folder SHALL make the folder, as the server canonicalizes it, the project's explicit root and, when the project still has its server-derived default name, SHALL name the project after the folder. Cancelling SHALL return to the chooser and leave the project awaiting a choice.

#### Scenario: Browsing and choosing

- **WHEN** the user opens a folder browser, types a directory's path, and chooses it
- **THEN** that directory becomes the project's explicit root, the project is named after the directory, and the project's first terminal starts there

#### Scenario: A renamed project keeps its name

- **WHEN** the user has renamed a project awaiting a start choice and then chooses a folder
- **THEN** the project keeps the name the user gave it

#### Scenario: The path appears once

- **WHEN** the folder browser is open on any folder
- **THEN** the folder's path appears only in the editable path field

#### Scenario: Typing filters the listing

- **WHEN** the path field holds `~/Documents/Pro`
- **THEN** the listing shows only the subdirectories of `~/Documents` whose names start with `pro`, ignoring case

#### Scenario: Hidden folders on request

- **WHEN** the typed segment is empty or does not start with `.`
- **THEN** no directory whose name starts with `.` is listed
- **WHEN** the typed segment starts with `.`
- **THEN** the directories whose names start with that segment are listed, hidden ones included

#### Scenario: Missing folder

- **WHEN** the path field names a parent folder that does not exist
- **THEN** the browser lists nothing, says the folder does not exist, and offers no folder to choose

#### Scenario: Clicking a folder goes into it

- **WHEN** the user clicks a listed folder
- **THEN** the path field holds that folder's path followed by a separator and lists its subdirectories, and the path field keeps keyboard focus

## ADDED Requirements

### Requirement: Folder browser keyboard completion

The folder browser's path field SHALL keep keyboard focus while the browser is open, and every key below SHALL act on the field without moving focus elsewhere. **Tab** SHALL complete the typed segment against the listed folders: a single match SHALL become the folder name followed by a separator; several matches SHALL extend the segment to their longest common prefix when that is longer than what was typed; and when it is not, repeated **Tab** SHALL cycle the field through each match followed by a separator, with **Shift+Tab** cycling backwards. When nothing matches, **Tab** SHALL leave the field unchanged and say that nothing matches. While the caret is at the end of the field, the browser SHALL show the text that **Tab** would add after the typed text in a subdued style, and **→** SHALL accept that text. **↓** and **↑** SHALL highlight listed folders in turn, wrapping at either end, and **Tab** or **→** SHALL then put the highlighted folder followed by a separator in the field. **Enter** SHALL choose the highlighted folder, else the folder the field names, else the only folder matching a typed segment, and otherwise SHALL say no such folder exists. The platform's delete-word chord (**⌥⌫** on macOS, **Ctrl+Backspace** elsewhere) SHALL delete the last path segment, as SHALL **⌃W** on macOS; elsewhere **Ctrl+W** remains the app's close shortcut. **⌘↑** on macOS and **Alt+↑** elsewhere SHALL replace the field with the parent folder. **Esc** SHALL first restore the text that was typed before a Tab cycle began, then clear a highlight or message, and otherwise close the browser as Cancel does.

#### Scenario: Tab completes a unique folder

- **WHEN** the field holds `~/Documents/Proj` and only `Projects` matches
- **THEN** Tab makes the field `~/Documents/Projects/`, lists its subdirectories, and focus stays in the field

#### Scenario: Tab fills the common prefix, then cycles

- **WHEN** the field holds `~/Documents/Projects/t` and `terminay`, `terminay-extensions`, and `terminay-site` match
- **THEN** the first Tab makes the field `~/Documents/Projects/terminay`
- **WHEN** the user presses Tab again and the common prefix adds nothing
- **THEN** the field becomes `~/Documents/Projects/terminay/`, the next Tab makes it `~/Documents/Projects/terminay-extensions/`, and Shift+Tab goes back

#### Scenario: Esc undoes a cycle

- **WHEN** the user cycles with Tab from `~/Do` and then presses Esc
- **THEN** the field holds `~/Do` again and the browser stays open

#### Scenario: Ghost completion

- **WHEN** the caret is at the end of `~/Documents/Projects/termi` and the matches share the prefix `terminay`
- **THEN** `nay` is shown after the caret in a subdued style, and → makes the field `~/Documents/Projects/terminay`

#### Scenario: Arrow highlight and accept

- **WHEN** the user presses ↓ twice and then Tab
- **THEN** the second listed folder is in the field followed by a separator

#### Scenario: Enter opens a unique partial match

- **WHEN** the field holds `~/Documents/Projects/mw` and only `mwpet` matches
- **THEN** Enter chooses `~/Documents/Projects/mwpet`

#### Scenario: Deleting a segment

- **WHEN** the field holds `~/Documents/Projects/` and the user presses Ctrl+Backspace, or ⌃W on macOS
- **THEN** the field holds `~/Documents/`

#### Scenario: Going to the parent

- **WHEN** the field holds `~/Documents/Projects/` and the user presses ⌘↑ on macOS
- **THEN** the field holds `~/Documents/`

#### Scenario: Esc closes when there is nothing to undo

- **WHEN** no Tab cycle, highlight, or message is active and the user presses Esc
- **THEN** the browser closes and the project stays awaiting a choice
