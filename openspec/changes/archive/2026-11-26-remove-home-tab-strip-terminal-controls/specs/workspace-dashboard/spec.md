## ADDED Requirements

### Requirement: Home tab strip carries no terminal-creation controls

Home's tab strip SHALL NOT show the New terminal tab (`+`) control or the New terminal with profile control that a project's panel tab strip shows, in any Home group, including groups made by arranging Home tabs side by side or stacked. Double-clicking empty space in Home's tab strip SHALL NOT create a terminal, and right-clicking Home's tab strip SHALL NOT open the profile chooser. A project's panel tab strip SHALL show both controls.

#### Scenario: Home's tab strip

- **WHEN** Home is the selected view on a wide workspace
- **THEN** Home's tab strip shows its tabs and no New terminal tab or New terminal with profile control

#### Scenario: Home tabs arranged side by side

- **WHEN** a user drags a Home tab to an edge of Home so two Home tab strips are shown
- **THEN** neither tab strip shows a New terminal tab or New terminal with profile control

#### Scenario: Double-clicking Home's empty tab strip

- **WHEN** a user double-clicks empty space in Home's tab strip
- **THEN** no terminal is created in any project

#### Scenario: Right-clicking Home's tab strip

- **WHEN** a user right-clicks Home's tab strip
- **THEN** the profile chooser does not open

#### Scenario: A project's panel tab strip

- **WHEN** a project is the selected view on a wide workspace
- **THEN** its panel tab strip shows the New terminal tab and New terminal with profile controls, and pressing New terminal tab creates a terminal in that project
