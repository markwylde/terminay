## ADDED Requirements

### Requirement: Dismissible project error banner

A project's error banner SHALL carry a dismiss control, whatever operation
raised the notice it shows. Activating the control SHALL remove the banner from
that project. The control SHALL be operable by pointer and by keyboard and SHALL
have an accessible name. A dismissed notice SHALL stay dismissed until another
failure is reported for that project, at which point the banner SHALL show the
new notice.

#### Scenario: Dismissing a notice

- **WHEN** a project's error banner is showing and the user activates its dismiss control
- **THEN** the banner is removed from that project

#### Scenario: Any failure is dismissible

- **WHEN** the banner shows a notice raised by a Git, Explorer, Agents, Settings, terminal, or other project operation
- **THEN** the same dismiss control is present and removes it

#### Scenario: A later failure after dismissal

- **WHEN** the user has dismissed a notice and another operation in that project then fails
- **THEN** the banner shows the new notice
