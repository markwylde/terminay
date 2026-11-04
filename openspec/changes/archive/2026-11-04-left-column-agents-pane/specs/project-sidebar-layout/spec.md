## MODIFIED Requirements

### Requirement: Sidebar group tab bar

The sidebar tab bar SHALL sit above the pane stack and SHALL use the same project chrome as the active project tab and panel tab strip so the colour continues across that band. It SHALL have two tabs, in order: Explorer with a file/folder icon, and Documentation. The Explorer group SHALL contain Files and Changes; Documentation SHALL contain Documentation. Every pane of the sidebar SHALL be scoped to the folder in front; a list that belongs to the whole project SHALL be a tab of the left column rather than a sidebar group. Additional panes SHALL join one of these groups rather than becoming a further top-level tab.

#### Scenario: Switching groups

- **WHEN** a user selects Explorer or Documentation in the tab bar
- **THEN** Explorer shows Files and Changes, and Documentation shows Documentation
- **AND** panes from another group are not visible

#### Scenario: Two groups at every width

- **WHEN** the sidebar renders side by side with the content or as a narrow-layout drawer
- **THEN** the tab bar offers Explorer and Documentation and no other tab

#### Scenario: Tab bar chrome

- **WHEN** the sidebar renders
- **THEN** the tab bar sits above the pane stack and uses the same project chrome colour as the active project tab and panel tab strip

### Requirement: Left column chrome band

The left column SHALL draw a band of project chrome above its content, the same height and colour as the panel tab strip and the sidebar's group tab bar, so the colour continues across all three columns. The band SHALL carry no title. It SHALL hold the left column's tab bar at its leading end. While the Tabs tab is selected it SHALL hold the **Tabs actions** control at its trailing end; while another tab is selected that control SHALL be absent.

#### Scenario: Band without a title

- **WHEN** the left column renders
- **THEN** the band shows the project chrome colour, the tab icons, and no text

#### Scenario: Tabs actions

- **WHEN** the Tabs tab is selected and a user activates the control at the trailing end of the band
- **THEN** the Tabs actions menu opens

#### Scenario: Actions control follows the Tabs tab

- **WHEN** the Agents tab is selected
- **THEN** the band shows no Tabs actions control
