## ADDED Requirements

### Requirement: New-project and environment-chooser placement

The new-project control SHALL sit at the end of the project tab strip as a split button, and SHALL NOT be displaced by trailing chrome. Its primary action creates a project on **This server**; its arrow opens the environment chooser. In a compact or overflowing bar the control SHALL remain reachable.

#### Scenario: Overflowing bar keeps the control reachable

- **WHEN** the project bar overflows
- **THEN** the split button remains visible and operable

### Requirement: Project tabs disclose their environment

A project tab SHALL disclose its project environment's provider and status subtly, without implying that the environment can be changed from the tab.

#### Scenario: Provider shown on the tab

- **WHEN** a project is bound to a non-default environment
- **THEN** its tab discloses the provider and the environment status
