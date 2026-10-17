## MODIFIED Requirements

### Requirement: View state stays local to each device

View state SHALL NOT sync: which terminal tab is selected, which project tab is selected, split layout and pane sizes, scroll position, and focus. A terminal created on one device SHALL be selected only on the device that created it. A device reading one terminal SHALL NOT be moved to another because a second device made or selected something. An MCP agent acting for a device SHALL change only that device's view, through the MCP workspace view, and SHALL NOT change any other device's view.

#### Scenario: Second device creates a terminal

- **WHEN** a second device creates or selects a terminal
- **THEN** the first device's selection, layout, pane sizes, scroll position, and focus are unchanged

#### Scenario: Agent arranges one device's tabs

- **WHEN** an agent the first device is talking to arranges tabs into a grid
- **THEN** the first device shows the grid and a second device showing the same folder keeps its own layout
