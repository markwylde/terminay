## MODIFIED Requirements

### Requirement: Terminal zoom scope

Desktop Zoom In, Zoom Out, and Reset Zoom SHALL change the terminal font size and Documentation editor text size only and SHALL publish a `terminal.zoom` host event. They SHALL NOT zoom the surrounding UI.

#### Scenario: Zoom invoked

- **WHEN** the user invokes Desktop Zoom In, Zoom Out, or Reset Zoom
- **THEN** the terminal font size and Documentation text size change and a `terminal.zoom` host event is published
- **AND** the surrounding UI is not zoomed
