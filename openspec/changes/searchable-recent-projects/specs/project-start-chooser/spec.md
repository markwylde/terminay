## REMOVED Requirements

### Requirement: Recent project folders

**Reason**: It bounded the list at 50 folders and dropped the least recently used. A server now keeps every recorded folder until it is forgotten.
**Migration**: See "Recent project folders are kept until forgotten" below, which carries the rest of the requirement unchanged.

## ADDED Requirements

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
