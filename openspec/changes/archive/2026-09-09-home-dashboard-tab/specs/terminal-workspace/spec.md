## MODIFIED Requirements

### Requirement: Per-device selection memory

Each device SHALL remember its own selection per project and restore it on reconnect, and SHALL remember whether the Home dashboard rather than a project was the selected view. That memory SHALL be treated as a hint: a remembered selection SHALL be validated against what exists and otherwise discarded, and a remembered Home selection that cannot be restored SHALL fall back to a project. Storage that is unavailable, full, or disabled SHALL mean the device starts fresh rather than failing. A device with nothing selected SHALL take the first terminal it adopts. When the selected terminal is closed anywhere, each device SHALL independently select a neighbour.

#### Scenario: Workspace changed while away

- **WHEN** a device reconnects to a workspace whose projects and terminals have changed
- **THEN** its remembered selection is validated against what exists and otherwise discarded

#### Scenario: Home remembered

- **WHEN** a device that had the Home dashboard selected reconnects
- **THEN** the Home dashboard is selected again

#### Scenario: Storage unavailable

- **WHEN** device storage is unavailable, full, or disabled
- **THEN** the device starts fresh rather than failing

#### Scenario: Nothing selected

- **WHEN** a device has nothing selected
- **THEN** it takes the first terminal it adopts rather than showing a blank workspace or following another device

#### Scenario: Selected terminal closed

- **WHEN** the selected terminal is closed anywhere
- **THEN** each device independently selects a neighbour
