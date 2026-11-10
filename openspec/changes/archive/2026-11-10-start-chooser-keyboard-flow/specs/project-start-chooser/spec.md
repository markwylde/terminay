## MODIFIED Requirements

### Requirement: Start chooser presentation

A project awaiting a start choice SHALL show a start chooser in its main panel area instead of a panel layout. The chooser SHALL offer **Open a folder**, **Home directory**, and the owning server's recent project folders. The chooser SHALL be fully operable by keyboard and by touch. The arrow keys SHALL move focus through the starts, the search box, each recent folder's row and Show more, in that order, and SHALL skip each row's forget control, which Tab SHALL still reach. From a forget control, ↓ SHALL move to the next item after its row and ↑ SHALL move to its row's folder. ↓ on the last item and ↑ on the first SHALL leave focus where it is. A focused recent folder SHALL be outlined across its whole row. The chooser SHALL fit the compact layout without horizontal scrolling. The chooser SHALL name the server that owns the project when more than one connection is attached.

#### Scenario: Chooser contents

- **WHEN** a project awaiting a start choice is shown
- **THEN** its main panel area shows Open a folder, Home directory, and the recent project folders of its server, and no terminal or panel

#### Scenario: Keyboard operation

- **WHEN** the chooser is shown and the user moves with the arrow and Tab keys and presses Enter
- **THEN** each start and each recent entry, including its forget control, can be reached and activated

#### Scenario: Arrows walk rows, not forget controls

- **WHEN** focus is on a recent folder that is not the last listed, and the user presses ↓
- **THEN** focus moves to the next recent folder, not to the focused folder's forget control, and the next folder's whole row is outlined

#### Scenario: Arrows from a forget control

- **WHEN** the user has tabbed to a recent folder's forget control and presses ↓ or ↑
- **THEN** ↓ focuses the next item after that row, and ↑ focuses that row's folder

#### Scenario: Compact layout

- **WHEN** the chooser is shown in the compact layout
- **THEN** every start and recent entry is reachable by vertical scrolling alone

### Requirement: The chooser searches every recent folder

When the server holds more than five recent folders, the chooser SHALL show a search box above the list, reachable with the arrow keys and Tab. When the search box first appears outside the compact layout, it SHALL take keyboard focus if focus is then on **Open a folder** or on nothing, and SHALL otherwise leave focus where it is. In the compact layout it SHALL NOT take focus, so a phone's on-screen keyboard does not cover the chooser. A query SHALL match a folder when every whitespace-separated term appears, ignoring case, in its name or full path, and SHALL search every recent folder of the server. Matches SHALL keep recency order and collapse to five as the full list does. Enter SHALL open the first available match; Escape SHALL clear the query. A query that matches nothing SHALL say so.

#### Scenario: Search box focused on show

- **WHEN** a new project's chooser is shown outside the compact layout for a server holding more than five recent folders, and the user has not moved focus while the list loaded
- **THEN** the search box has keyboard focus, so typing searches at once

#### Scenario: Focus already moved

- **WHEN** the user moves focus to Home directory, or opens the folder browser, before the recent list arrives
- **THEN** the search box appears without taking focus

#### Scenario: Compact layout keeps focus off the search box

- **WHEN** the chooser is shown in the compact layout for a server holding more than five recent folders
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
