# project-start-chooser Specification

## Purpose

Define how a new project chooses its server-side root or starts in the account home, including folder browsing and recent folders.

## Requirements

### Requirement: Projects awaiting a start choice

A project created from the UI without a root SHALL be held by its server as awaiting a start choice. While it awaits a choice it SHALL have no root, no terminal, and no panels, and every client of that server SHALL present it the same way. The state SHALL persist across client reconnects and server restarts until a start choice is made. Closing a project that awaits a start choice SHALL proceed immediately, with no close warning.

#### Scenario: Created without a root

- **WHEN** a user creates a project from the project bar, the File menu, or the compact switcher
- **THEN** the server commits it awaiting a start choice, with no root and no terminal

#### Scenario: Seen from a second client

- **WHEN** a project awaits a start choice and another client of the same server shows it
- **THEN** that client shows the same start chooser

#### Scenario: Closing before choosing

- **WHEN** a user closes a project that awaits a start choice
- **THEN** it closes immediately with no warning

### Requirement: Start chooser presentation

A project awaiting a start choice SHALL show a start chooser in its main panel area instead of a panel layout. The chooser SHALL offer **Open a folder**, **Home directory**, and the owning server's recent project folders. The chooser SHALL be fully operable by keyboard and by touch, and SHALL fit the compact layout without horizontal scrolling. The chooser SHALL name the server that owns the project when more than one connection is attached.

#### Scenario: Chooser contents

- **WHEN** a project awaiting a start choice is shown
- **THEN** its main panel area shows Open a folder, Home directory, and the recent project folders of its server, and no terminal or panel

#### Scenario: Keyboard operation

- **WHEN** the chooser is shown and the user moves with the arrow and Tab keys and presses Enter
- **THEN** each start and each recent entry, including its forget control, can be reached and activated

#### Scenario: Compact layout

- **WHEN** the chooser is shown in the compact layout
- **THEN** every start and recent entry is reachable by vertical scrolling alone

### Requirement: A start choice is one server command

A start choice SHALL be committed by the owning server as one command that sets the project's root, or its lack of one, ends the awaiting state, and launches the project's first terminal through the normal terminal-launch resolver. The server SHALL accept only the first start choice for a project. A later choice from any client SHALL be refused with a typed conflict, and that client SHALL show the project as the server holds it. A choice whose folder fails validation SHALL leave the project awaiting a choice and SHALL show the failure in the chooser.

#### Scenario: Choosing a start

- **WHEN** the user makes a start choice
- **THEN** the server sets the project's root or no root, ends the awaiting state, and launches one terminal in the project

#### Scenario: Two clients choose at once

- **WHEN** two clients make different start choices for the same project
- **THEN** the server applies the first, refuses the second with a conflict, and both clients show the project started with the first choice

#### Scenario: Chosen folder no longer exists

- **WHEN** the user chooses a folder that does not exist or is not a directory on the server
- **THEN** the project keeps awaiting a choice and the chooser shows why the folder was refused

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

#### Scenario: Completing a typed path

- **WHEN** the user types `/Users/mark/Doc` into the browser's path field
- **THEN** the browser suggests the subdirectories of `/Users/mark` that start with `Doc`, and accepting one fills in its full path

#### Scenario: Stable height

- **WHEN** the user moves from a folder with two subdirectories to one with two hundred and back
- **THEN** the browser keeps the same height throughout and the longer listing scrolls inside it

#### Scenario: Remote client

- **WHEN** the user opens a folder from a browser or phone client of a remote server
- **THEN** the folders listed are that server's, and no native dialog of the client device opens

#### Scenario: Cancelling

- **WHEN** the user cancels the folder browser
- **THEN** the chooser is shown again and the project still awaits a choice

### Requirement: Home directory start

**Home directory** SHALL start the project with no root folder. Its terminals SHALL launch in the server account's verified home directory unless a terminal is given its own explicit working directory. A project with no root folder SHALL keep that state until the user sets a root, and SHALL add nothing to the recent project folders.

#### Scenario: Starting in home

- **WHEN** the user chooses Home directory
- **THEN** the project has no root folder and its first terminal starts in the server account's home directory

#### Scenario: Another terminal in a no-root project

- **WHEN** the user creates another terminal in a project with no root folder
- **THEN** it launches in the server account's home directory

### Requirement: Root folder browsing scope

The server's root folder browse query SHALL return only the names of directories and SHALL NEVER return file names, file contents, or file metadata. It SHALL resolve and canonicalize the requested folder on the server at each request, SHALL return at most a bounded number of entries with a typed truncation marker, and SHALL report a missing, unreadable, or non-directory folder as a typed error. It SHALL require the same device authority as setting a project root on that server. It SHALL NOT be reachable through MCP capability tokens.

#### Scenario: Directories only

- **WHEN** a client browses a folder that holds files and directories
- **THEN** only the directory names are returned

#### Scenario: Unauthorised device

- **WHEN** a device without authority to change project roots on the server browses folders
- **THEN** the request is refused before any filesystem access

#### Scenario: Very large folder

- **WHEN** a client browses a folder holding more directories than the bound
- **THEN** the bounded set is returned with a truncation marker

#### Scenario: Unreadable folder

- **WHEN** a client browses a folder the server account cannot read
- **THEN** a typed error is returned and the browser shows it in place of a listing

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

### Requirement: Recent project folders are kept until forgotten

Each server SHALL keep its own list of recent project folders, holding every canonical folder path that has become an explicit project root on that server, most recently used first, with no duplicates. A folder SHALL be recorded, or moved to the front, whenever it becomes a project's explicit root on that server, from the folder browser, a recent entry, or Set Root From Working Directory. A server default root and a no-root start SHALL NOT be recorded. A folder SHALL leave the list only when it is forgotten. Each entry SHALL show the folder's name and its full path. Opening an entry whose folder is already the root of another project on the same server SHALL show that project and SHALL close the project awaiting a choice, creating nothing. Otherwise opening an entry SHALL set the project's root, SHALL name the project after the folder when the project still has its server-derived default name, and SHALL keep the project's colour and icon. Each entry SHALL offer **Forget**, which removes it from the server's list for every client and changes no project. A recorded folder that no longer exists SHALL be shown as unavailable, SHALL NOT be openable, and SHALL remain forgettable.

#### Scenario: Recording a chosen folder

- **WHEN** a folder becomes a project's explicit root
- **THEN** it appears first in that server's recent project folders, once

#### Scenario: The list keeps every folder

- **WHEN** a server already holds 50 recent folders and another folder is recorded
- **THEN** the new folder is first and all 50 earlier folders remain, in recency order

#### Scenario: Opening a recent folder

- **WHEN** the user opens a recent folder from the chooser
- **THEN** the project takes that folder as its root and is named after it, keeps its colour and icon, and the folder moves to the front of the list

#### Scenario: Opening a recent folder another project already has

- **WHEN** the user opens a recent folder that is already the root of another open project on the same server
- **THEN** that project is shown, the project awaiting a choice is closed, and no project is created or changed

#### Scenario: Forgetting a recent folder

- **WHEN** the user forgets a recent folder
- **THEN** it leaves the server's list for every client, and no project's root changes

#### Scenario: A recent folder that is gone

- **WHEN** a recent folder no longer exists on the server
- **THEN** its entry is shown as unavailable, cannot be opened, and can be forgotten

#### Scenario: Recents belong to their server

- **WHEN** a window attaches two servers and shows a chooser for a project on one of them
- **THEN** only that server's recent folders are listed

### Requirement: The chooser collapses recent folders to five

The chooser SHALL show at most the five most recent folders of the list it presents, followed by a **Show more** control naming how many more there are. **Show more** SHALL reveal every remaining folder of that list and move focus to the first folder it revealed.

#### Scenario: Many recent folders

- **WHEN** the chooser is shown for a server holding twelve recent folders
- **THEN** the five most recent are listed, with a Show more control naming seven more below them

#### Scenario: Showing more

- **WHEN** the user activates Show more
- **THEN** all twelve folders are listed and Show more is gone

#### Scenario: Few recent folders

- **WHEN** the server holds five or fewer recent folders
- **THEN** every one is listed, with no search box and no Show more control

### Requirement: The chooser searches every recent folder

When the server holds more than five recent folders, the chooser SHALL show a search box above the list, reachable with the arrow keys and Tab. A query SHALL match a folder when every whitespace-separated term appears, ignoring case, in its name or full path, and SHALL search every recent folder of the server. Matches SHALL keep recency order and collapse to five as the full list does. Enter SHALL open the first available match; Escape SHALL clear the query. A query that matches nothing SHALL say so.

#### Scenario: Searching beyond the five shown

- **WHEN** the user types part of the name of the tenth most recent folder into the search box
- **THEN** that folder is listed, along with any other matches, in recency order

#### Scenario: Opening the first match

- **WHEN** the user types a query and presses Enter
- **THEN** the first available matching folder is opened as if its entry were activated

#### Scenario: Nothing matches

- **WHEN** the query matches no recent folder
- **THEN** the chooser says no recent projects match it
