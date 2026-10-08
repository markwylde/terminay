## MODIFIED Requirements

### Requirement: Unified compact switcher

A compact workspace SHALL provide one switcher that presents every terminal of every project of every attached connection, grouped by connection and then by project. Each project group SHALL name its project with that project's colour. Each terminal row SHALL name its terminal and SHALL activate that terminal on its own server when pressed, selecting that terminal's project first when it is not the active one. A connection heading SHALL appear for every attached connection, including when only one is attached, so a row's owning server is never ambiguous. The switcher SHALL offer a new terminal for each folder it lists, a new terminal for each project group whose folders it does not list, a new terminal where the user already is, New project, and Add connection, so every create action absorbed from the collapsed chrome remains reachable. The new terminal for where the user already is SHALL be absent when no project is in front rather than acting on an arbitrary one. The switcher SHALL open from the breadcrumb and from the connection control, presenting the same content from both.

#### Scenario: Grouped by connection and project
- **WHEN** the switcher opens with two attached connections holding projects with terminals
- **THEN** rows appear under a heading for each connection and a group for each project of that connection

#### Scenario: Activating a terminal in a background project
- **WHEN** a user presses a terminal row belonging to a project that is not active
- **THEN** that project becomes active on its own server and that terminal becomes the active terminal

#### Scenario: Connection control opens the same switcher
- **WHEN** a user presses the connection control on a compact workspace
- **THEN** the unified switcher opens with the same grouped content the breadcrumb opens

#### Scenario: Create actions survive the collapse
- **WHEN** the switcher is open with a project in front
- **THEN** it offers a new terminal on each listed folder, a new terminal where the user already is, New project, and Add connection

#### Scenario: A project whose folders are not listed
- **WHEN** the switcher lists a project without listing its folders
- **THEN** that project's header offers a new terminal for the project

#### Scenario: No project in front
- **WHEN** the switcher is open while the dashboard is selected
- **THEN** the new terminal for where the user already is is absent, and the other create actions remain

#### Scenario: Single connection still names its server
- **WHEN** exactly one connection is attached
- **THEN** its heading still appears above its project groups

### Requirement: Compact switcher terminal creation shows the created terminal

A terminal created from the compact switcher SHALL become the active terminal of its project: it SHALL be the terminal shown on screen, it SHALL receive terminal focus, and the switcher SHALL mark it as current the next time it opens. This SHALL hold for the create bar's new-terminal control, which creates in the project in front and its selected folder; for a folder label's new-terminal control, which SHALL select that folder and its project first when they are not in front and SHALL create the terminal in that folder; and for a project header's new-terminal control, which SHALL select that project on its own server first when it is not the project in front. The switcher SHALL dismiss when any create action is pressed. The terminal on screen and the switcher's current row SHALL never name different terminals after a create.

#### Scenario: New terminal in the project in front
- **WHEN** a user opens the compact switcher and presses the create bar's new-terminal control
- **THEN** the switcher dismisses, a terminal is created in the selected folder of the project in front, and that terminal replaces the previous one on screen and takes terminal focus

#### Scenario: New terminal in another folder of the project in front
- **WHEN** a user presses the new-terminal control on a folder label that is not the selected folder of the project in front
- **THEN** that folder becomes selected, the created terminal belongs to it, and it is the terminal shown on screen

#### Scenario: New terminal in a folder of a background project
- **WHEN** a user presses the new-terminal control on a folder label of a project that is not the project in front
- **THEN** that project becomes active with that folder selected, and the created terminal belongs to that folder and is the terminal shown on screen

#### Scenario: New terminal in a background project
- **WHEN** a user presses the new-terminal control on the header of a project that is not the project in front
- **THEN** that project becomes active on its own server and the created terminal is the terminal shown on screen

#### Scenario: Switcher agrees with the screen
- **WHEN** a user reopens the compact switcher after creating a terminal from it
- **THEN** the row marked current is the created terminal, which is also the terminal on screen

### Requirement: Project switcher rows show the activity dot

Each project row in the project switcher menu SHALL show the same activity dot as that project's tab, before the project name, with the same state, colour, breathing effect, and hiding behaviour, so projects that have overflowed out of the strip remain covered. A row's dot SHALL reflect only terminals of that row's own project on its own server. A project header in the compact switcher SHALL NOT show the activity dot; it presents the project's status summary.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows one amber breathing dot before its name

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and one of them has a working terminal
- **THEN** only that project's row shows the dot

#### Scenario: Compact switcher header carries no dot

- **WHEN** the compact switcher lists a project that has a working terminal
- **THEN** that project's header shows its colour swatch and its status summary, and no activity dot

## ADDED Requirements

### Requirement: Compact switcher project cards

Each project group in the compact switcher SHALL be presented as a card: a bordered container that encloses the project's header and every folder label and panel row belonging to that project, so that what belongs to a project is shown by containment rather than by indentation. The card's border and its header's background SHALL be tinted with that project's colour. The header SHALL carry, in order, the project's colour swatch, the project's name, the project's status summary, and the project's close control. The project name SHALL truncate before the status summary does. A project with no terminal SHALL show no status summary. Nothing belonging to one project SHALL be drawn inside another project's card.

#### Scenario: A project is one card

- **WHEN** the switcher lists a project with two folders and three terminals
- **THEN** one bordered card encloses that project's header, both folder labels, and all three terminal rows

#### Scenario: Card takes the project's colour

- **WHEN** the switcher lists two projects with different colours
- **THEN** each card's border and header are tinted with its own project's colour

#### Scenario: Long project name

- **WHEN** a project's name is too long for its header
- **THEN** the name is truncated and the status summary and close control remain fully visible

#### Scenario: Project with no terminals

- **WHEN** a project holds no terminal
- **THEN** its header shows no status summary

### Requirement: Compact switcher folder labels

Inside a project's card the switcher SHALL list every folder this window knows that project to have, in the project's folder order, each as a single label line naming the folder, with that folder's panel rows beneath it. A project whose only folder is General SHALL still show that folder's label. A folder that holds no panel SHALL be presented as its label line alone, with no placeholder row. Pressing a folder label SHALL show that folder, selecting its project first when it is not the project in front. Each folder label SHALL carry a new-terminal control whose accessible name states the folder and the project it creates in. A project whose folders this window does not know SHALL list its panel rows directly beneath its header with no folder label.

#### Scenario: Folder with terminals

- **WHEN** a project has a folder holding two terminals
- **THEN** the card shows that folder's label line followed by its two terminal rows

#### Scenario: Empty folder

- **WHEN** a project has a folder holding no panel
- **THEN** the card shows that folder's label line and nothing beneath it before the next folder

#### Scenario: Single General folder

- **WHEN** a project's only folder is General
- **THEN** the card shows a General label line above that project's panel rows

#### Scenario: Pressing a folder label

- **WHEN** a user presses the label of an empty folder
- **THEN** the switcher dismisses and that folder is shown

#### Scenario: Folders not known

- **WHEN** the switcher lists a project whose folders this window does not know
- **THEN** that project's panel rows appear directly beneath its header and no folder label is shown

### Requirement: Compact switcher create bar

The compact switcher SHALL end in a create bar that stays in place while the list above it scrolls. When a project is in front, the bar SHALL hold one wide control that creates a terminal in that project's selected folder and whose visible label names both, in the form `Terminal in <project> › <folder>`, beside narrower icon controls for New project and Add connection. The label SHALL truncate rather than wrap, and the control's accessible name SHALL state the project and folder in full. When no project is in front, the bar SHALL offer no new-terminal control, and New project SHALL be the wide control with Add connection beside it. The icon controls SHALL each carry an accessible name stating their action. The create bar SHALL remain when a filter matches nothing.

#### Scenario: Label names where the terminal will be created

- **WHEN** the switcher opens with project Infra in front and its General folder selected
- **THEN** the create bar's wide control reads `Terminal in Infra › General`

#### Scenario: Label follows the selected folder

- **WHEN** the selected folder of the project in front changes and the switcher is opened again
- **THEN** the wide control names the newly selected folder

#### Scenario: No project in front

- **WHEN** the switcher is open while the dashboard is selected
- **THEN** the create bar offers no new-terminal control, and New project is the wide control with Add connection beside it

#### Scenario: Icon controls are named

- **WHEN** assistive technology reads the create bar
- **THEN** it announces a control for New project and a control for Add connection

#### Scenario: Filter matches nothing

- **WHEN** a filter matches no terminal, project, or connection
- **THEN** the create bar is still present with all of its controls
