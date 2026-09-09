## ADDED Requirements

### Requirement: Project tab activity count badge

Each project tab SHALL present a single activity count badge after the tab title and before the close control. The badge SHALL show the number of that project's terminals that currently have a visible activity indicator, using the same per-terminal items that feed the header activity dropdown, so the **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it without a separate setting. The badge SHALL be coloured by the highest-priority state present in the project: red when any terminal needs attention, otherwise amber when any terminal is working, otherwise green when any terminal has finished unviewed activity. The badge SHALL be hidden when the project's count is zero, SHALL appear on the active project tab as well as background tabs, and SHALL NOT be a separate control; pressing it activates the project like the rest of the tab. The badge SHALL use its own element class, distinct from the header activity dropdown badges, so each surface can be located independently.

#### Scenario: One finished terminal in a background project

- **WHEN** a background project has exactly one terminal with a finished unviewed indicator and no other indicators
- **THEN** its tab shows a green badge reading `1` between the title and the close control

#### Scenario: Mixed states resolve to the highest priority

- **WHEN** a project has one terminal needing attention, one working terminal, and one finished unviewed terminal
- **THEN** its tab shows a red badge reading `3`

#### Scenario: Active project counts too

- **WHEN** the active project has a terminal whose structured completion produced a finished indicator
- **THEN** the active project tab shows a green badge including that terminal

#### Scenario: Badge hidden at zero

- **WHEN** every terminal in a project has been viewed and none is working or needs attention
- **THEN** the project tab shows no badge

#### Scenario: Pressing the badge

- **WHEN** a user presses the badge on a background project tab
- **THEN** that project becomes active and no other action occurs

### Requirement: Project switcher rows show the activity count badge

Each project row in the project switcher menu SHALL show the same activity count badge as that project's tab, with the same count, colour, and zero-hiding behaviour, so projects that have overflowed out of the strip or are hidden behind the compact switcher remain covered.

#### Scenario: Overflowed project with activity

- **WHEN** a project has overflowed out of the tab strip and has two working terminals
- **THEN** its row in the project switcher menu shows an amber badge reading `2`

### Requirement: Overflow layout accounts for the activity badge

The tab bar overflow layout SHALL re-evaluate when any project's activity count badge appears, disappears, or changes width, so that tabs never spill past the trailing chrome and the switcher always accounts for the current tab widths.

#### Scenario: Badge appears on a strip that just fits

- **WHEN** the strip exactly fits and a badge appears on one tab
- **THEN** the overflow layout re-runs and the trailing chrome remains fully visible, with a tab overflowing into the switcher if required
