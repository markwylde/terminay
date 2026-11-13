## MODIFIED Requirements

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
- **THEN** every one is listed below the search box, with no Show more control

### Requirement: The chooser searches every recent folder

When the server holds any recent folder, the chooser SHALL show a search box above the list, reachable with the arrow keys and Tab. When the search box first appears outside the compact layout, it SHALL take keyboard focus if focus is then on **Open a folder** or on nothing, and SHALL otherwise leave focus where it is. In the compact layout it SHALL NOT take focus, so a phone's on-screen keyboard does not cover the chooser. A query SHALL match a folder when every whitespace-separated term appears, ignoring case, in its name or full path, and SHALL search every recent folder of the server. Matches SHALL keep recency order and collapse to five as the full list does. Enter SHALL open the first available match; Escape SHALL clear the query. A query that matches nothing SHALL say so.

#### Scenario: Search box focused on show

- **WHEN** a new project's chooser is shown outside the compact layout for a server holding recent folders, and the user has not moved focus while the list loaded
- **THEN** the search box has keyboard focus, so typing searches at once

#### Scenario: Focus already moved

- **WHEN** the user moves focus to Home directory, or opens the folder browser, before the recent list arrives
- **THEN** the search box appears without taking focus

#### Scenario: Compact layout keeps focus off the search box

- **WHEN** the chooser is shown in the compact layout for a server holding recent folders
- **THEN** the search box appears without taking focus

#### Scenario: Type, arrow down, Enter

- **WHEN** the user types a query matching at least two available folders, presses ↓ twice, and presses Enter
- **THEN** the second matching folder is opened

#### Scenario: Searching beyond the five shown

- **WHEN** the user types part of the name of the tenth most recent folder into the search box
- **THEN** that folder is listed, along with any other matches, in recency order

#### Scenario: Opening the first match

- **WHEN** the user types a query and presses Enter
- **THEN** the first available matching folder is opened as if its entry were activated

#### Scenario: Nothing matches

- **WHEN** the query matches no recent folder
- **THEN** the chooser says no recent projects match it

#### Scenario: Search box with few recent folders

- **WHEN** the chooser is shown for a server holding two recent folders
- **THEN** the search box is shown above them
