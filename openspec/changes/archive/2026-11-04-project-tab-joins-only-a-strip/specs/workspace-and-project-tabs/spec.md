## MODIFIED Requirements

### Requirement: Joined chrome band

The active project tab's colour SHALL continue into the panel tab strip and the sidebar group tab bar so that chrome reads as one band. When the active project shows no panel tab strip, such as while it awaits its start choice, the active project tab SHALL be a closed rounded shape within the project bar rather than running down into the workspace. Sidebar pane titles SHALL use the dark project-bar surface with white labels, and pane bodies SHALL share the terminal background. Sidebar pane titles SHALL stay quiet on hover; only title actions such as refresh, explorer file rows, and the 4px resize rail SHALL highlight. The sidebar toggle SHALL be an icon on the dark project bar that highlights slightly on hover. The new-project `+` SHALL be an icon button with the same even pacing as the panel-strip add controls rather than a joined chip. Panel tabs on that strip SHALL use a 4px corner, the active panel tab SHALL be the solid chip, and inactive tabs SHALL stay quiet until hover.

#### Scenario: Active project colour
- **WHEN** a project tab is active
- **THEN** its colour continues into the panel tab strip and the sidebar group tab bar as one band

#### Scenario: Active project awaiting its start
- **WHEN** the active project shows its start chooser and no panel tab strip
- **THEN** its project tab is a closed rounded shape within the project bar and does not run into the chooser

#### Scenario: Hovering sidebar chrome
- **WHEN** a user hovers a sidebar pane title
- **THEN** the title stays quiet while title actions, explorer file rows, and the 4px resize rail highlight

#### Scenario: Panel tab states
- **WHEN** panel tabs are shown
- **THEN** the active tab is a solid 4px-cornered chip and inactive tabs stay quiet until hover
