## REMOVED Requirements

### Requirement: Project activity count follows viewed terminals

**Reason**: The project tab no longer carries a count; its indicator is a status dot.
**Migration**: Covered by "Project activity dot follows viewed terminals".

### Requirement: Project tab activity count badge

**Reason**: Replaced by a status dot before the title that matches the terminal tab indicator.
**Migration**: Covered by "Project tab activity dot".

### Requirement: Project switcher rows show the activity count badge

**Reason**: Switcher rows show the same dot as the project tab.
**Migration**: Covered by "Project switcher rows show the activity dot".

### Requirement: Overflow layout accounts for the activity badge

**Reason**: The element whose appearance changes tab width is now the dot.
**Migration**: Covered by "Overflow layout accounts for the activity dot".

## ADDED Requirements

### Requirement: Project tab activity dot

Each project tab SHALL present a single activity dot immediately before the tab title. The dot SHALL be the same indicator a terminal tab shows for its own status: the same size, the same colours, and the same breathing effect while working. The dot SHALL carry no number. It SHALL reflect that project's terminals that currently have a visible activity indicator, using the same per-terminal items that feed the header Notifications list, so the **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it without a separate setting. The dot SHALL reflect only terminals of that tab's own project on its own server. The dot SHALL take the highest-priority state present in the project: red when any terminal needs attention, otherwise amber and breathing when any terminal is working, otherwise green when any terminal has finished unviewed activity. The dot SHALL be hidden when no terminal in the project has a visible indicator, SHALL appear on the active project tab as well as background tabs, and SHALL NOT be a separate control; pressing it activates the project like the rest of the tab. Its accessible name SHALL state the project's state and how many terminals are in it.

#### Scenario: One working terminal

- **WHEN** a project has exactly one working terminal and no other indicators
- **THEN** its tab shows an amber breathing dot before the title, the same size as the dot on that terminal's tab, and no number

#### Scenario: One finished terminal in a background project

- **WHEN** a background project has exactly one terminal with a finished unviewed indicator and no other indicators
- **THEN** its tab shows a steady green dot before the title

#### Scenario: Mixed states resolve to the highest priority

- **WHEN** a project has one terminal needing attention, one working terminal, and one finished unviewed terminal
- **THEN** its tab shows a single red dot

#### Scenario: Active project shows the dot too

- **WHEN** the active project has a terminal whose structured completion produced a finished indicator
- **THEN** the active project tab shows a green dot

#### Scenario: Dot hidden with nothing to show

- **WHEN** every terminal in a project has been viewed and none is working or needs attention
- **THEN** the project tab shows no dot and the title sits where it would without one

#### Scenario: Pressing the dot

- **WHEN** a user presses the dot on a background project tab
- **THEN** that project becomes active and no other action occurs

#### Scenario: Activity on another attached server

- **WHEN** a project on one attached server has a working terminal
- **THEN** only that project's tab shows a dot and tabs of every other server are unaffected

#### Scenario: Reduced motion

- **WHEN** the system requests reduced motion and a project has a working terminal
- **THEN** its tab shows a steady amber dot

### Requirement: Project activity dot follows viewed terminals

The project-tab activity dot SHALL reflect the same terminals that currently show a visible activity indicator, resolved by the pair of the tab's server and its project. Clicking a terminal tab, clicking into the terminal, typing, dismissing its notification, or already interacting with it when finished or attention activity arrives, SHALL remove that terminal from the dot's state. Activating the project SHALL NOT remove a terminal from it. A working terminal SHALL keep contributing while it is working, including when its tab is focused. The dot SHALL hide when no terminal contributes.

#### Scenario: Activating the project keeps the dot

- **WHEN** a project shows a green dot because a single terminal has finished unviewed activity, and the user activates that project without clicking the terminal
- **THEN** the project tab dot remains green

#### Scenario: Focusing the last finished terminal

- **WHEN** a project shows a green dot because a single terminal has finished unviewed activity, and the user clicks that terminal tab
- **THEN** the project tab dot hides

#### Scenario: Completion on the focused terminal

- **WHEN** the only activity in a project is structured or agent completion on the terminal the user is already viewing
- **THEN** the project tab dot stays hidden

#### Scenario: Working on the focused terminal

- **WHEN** the focused terminal in a project is working and no other terminal in that project has an indicator
- **THEN** the project tab keeps an amber breathing dot

#### Scenario: Identical project ids on two servers

- **WHEN** two attached servers each hold a project with the same id and only one of them has an unviewed finished terminal
- **THEN** only that server's tab shows the dot

### Requirement: Project switcher rows show the activity dot

Each project row in the project switcher menu and in the compact switcher SHALL show the same activity dot as that project's tab, before the project name, with the same state, colour, breathing effect, and hiding behaviour, so projects that have overflowed out of the strip or are hidden behind the compact switcher remain covered. A row's dot SHALL reflect only terminals of that row's own project on its own server.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows one amber breathing dot before its name

#### Scenario: Same project id on two servers

- **WHEN** two attached servers each hold a project with the same id and one of them has a working terminal
- **THEN** only that project's row shows the dot

### Requirement: Overflow layout accounts for the activity dot

The tab bar overflow layout SHALL re-evaluate when any project's activity dot appears or disappears, so that tabs never spill past the trailing chrome and the switcher always accounts for the current tab widths.

#### Scenario: Dot appears on a strip that just fits

- **WHEN** the strip exactly fits and a dot appears on one tab
- **THEN** the overflow layout re-runs and the trailing chrome remains fully visible, with a tab overflowing into the switcher if required
