## ADDED Requirements

### Requirement: Server-resolved dynamic form options
Provider form fields whose options are determined by the server SHALL be
resolved through the fixed, validated `project-environments.resolve-options`
operation, which carries the provider, profile, option source, current field
values, and an optional query, and SHALL be abortable. A client SHALL NOT call a
provider endpoint directly, and a malformed or stale provider response SHALL be
rejected rather than rendered.

#### Scenario: Dependent field changes
- **WHEN** a field that other options depend on changes
- **THEN** the dependent options are re-resolved with the current values and any
  in-flight resolution for the previous values is aborted

#### Scenario: Options still loading
- **WHEN** option resolution is in flight
- **THEN** the control shows an explicit loading state rather than an empty
  inert select

#### Scenario: No options available
- **WHEN** the provider returns no options
- **THEN** the control shows an explicit empty state

#### Scenario: Provider error or hostile response
- **WHEN** option resolution fails or returns a malformed or stale response
- **THEN** the control shows an explicit provider-error state and no option data
  is rendered

### Requirement: Provider creation actions
The project chooser SHALL project the selected server's installed providers and
saved profiles and SHALL offer direct creation actions for them, including
**New SSH** and **Create new Puzed VM**. Selecting an action SHALL open the
requested profile or environment form directly, without changing the selected
server or bypassing the Project Environments management surface.

#### Scenario: Installed provider offered in the chooser
- **WHEN** an SSH or Puzed provider is installed on the selected server
- **THEN** the project chooser offers its direct creation action alongside the
  server's saved profiles

#### Scenario: Creation action invoked
- **WHEN** a user invokes a provider creation action from the chooser
- **THEN** the requested profile or environment form opens directly and the
  Project Environments sidebar and selected-server authority are unchanged

#### Scenario: Native and browser hosts
- **WHEN** the action is invoked from a Desktop host or a browser host
- **THEN** the same form is routed and opened by that host's intent path
