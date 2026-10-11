## MODIFIED Requirements

### Requirement: Project tab activity dot

Each project tab SHALL present a single activity dot immediately before the tab title. The dot SHALL be the same indicator a terminal tab shows for its own status: the same size, the same colours, and the same breathing effect while working. The dot SHALL carry no number. It SHALL reflect that project's terminals that currently have a visible activity indicator, read from the same per-terminal state as the terminal tab indicators, so the **Show indicator for active tabs** and **Show indicator for finished tabs** settings govern it without a separate setting. The dot SHALL show a terminal's state as soon as the server reports it and SHALL NOT wait for the notification settle period that governs the header Notifications list. The dot SHALL reflect only terminals of that tab's own project on its own server. The dot SHALL take the highest-priority state present in the project: red when any terminal needs attention, otherwise amber and breathing when any terminal is working, otherwise green when any terminal has finished unviewed activity. The dot SHALL be hidden when no terminal in the project has a visible indicator, SHALL appear on the active project tab as well as background tabs, and SHALL NOT be a separate control; pressing it activates the project like the rest of the tab. Its accessible name SHALL state the project's state and how many terminals are in it.

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

#### Scenario: The dot does not wait for the notification

- **WHEN** a terminal in a background project starts needing attention
- **THEN** that project's tab shows a red dot at once, before the header Notifications count includes it
