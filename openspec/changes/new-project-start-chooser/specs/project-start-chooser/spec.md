## ADDED Requirements

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

**Open a folder** SHALL open a folder browser served by the project's server, in every client host, starting at the server account's home directory. The browser SHALL list the directories of the current folder, let the user enter a directory, go to its parent, and type or paste a path. Choosing a folder SHALL make it the project's explicit root. Cancelling SHALL return to the chooser and leave the project awaiting a choice.

#### Scenario: Browsing and choosing

- **WHEN** the user opens a folder browser, enters a directory, and chooses it
- **THEN** that directory becomes the project's explicit root and the project's first terminal starts there

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

### Requirement: Recent project folders

Each server SHALL keep its own list of recent project folders, holding at most 50 canonical folder paths, most recently used first, with no duplicates. A folder SHALL be recorded, or moved to the front, whenever it becomes a project's explicit root on that server, from the folder browser, a recent entry, or Set Root From Working Directory. A server default root and a no-root start SHALL NOT be recorded. Recording a 51st folder SHALL drop the least recently used one. Each entry SHALL show the folder's name and its full path. Opening an entry SHALL set only the project's root, and the project SHALL keep its own name, colour, and icon. Each entry SHALL offer **Forget**, which removes it from the server's list for every client and changes no project. A recorded folder that no longer exists SHALL be shown as unavailable, SHALL NOT be openable, and SHALL remain forgettable.

#### Scenario: Recording a chosen folder

- **WHEN** a folder becomes a project's explicit root
- **THEN** it appears first in that server's recent project folders, once

#### Scenario: The list is bounded

- **WHEN** a server already holds 50 recent folders and another folder is recorded
- **THEN** the new folder is first and the least recently used folder is dropped

#### Scenario: Opening a recent folder

- **WHEN** the user opens a recent folder from the chooser
- **THEN** the project takes that folder as its root, keeps its default name, colour, and icon, and the folder moves to the front of the list

#### Scenario: Forgetting a recent folder

- **WHEN** the user forgets a recent folder
- **THEN** it leaves the server's list for every client, and no project's root changes

#### Scenario: A recent folder that is gone

- **WHEN** a recent folder no longer exists on the server
- **THEN** its entry is shown as unavailable, cannot be opened, and can be forgotten

#### Scenario: Recents belong to their server

- **WHEN** a window attaches two servers and shows a chooser for a project on one of them
- **THEN** only that server's recent folders are listed

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
