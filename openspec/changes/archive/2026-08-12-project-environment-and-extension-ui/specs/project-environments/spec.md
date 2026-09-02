## ADDED Requirements

### Requirement: Project split button and environment chooser

The project bar SHALL present a split button. Its primary `+` action SHALL create a project on the reserved **This server** environment immediately, without an intermediate chooser. Its arrow action SHALL open a chooser that groups recently used targets, offers searchable browse routes over the server's environments, and provides entry points to create or select an SSH or Puzed environment and to manage environments and extensions. The chooser SHALL NOT be confusable with the server selector: it selects a project environment on the already-selected server.

#### Scenario: Primary action creates on This server

- **WHEN** the user activates the primary `+` action
- **THEN** a project is created on **This server** without an intermediate chooser

#### Scenario: Arrow opens the environment chooser

- **WHEN** the user activates the arrow action
- **THEN** a chooser opens with grouped recent targets, searchable browse routes, and entry points to create or select an SSH or Puzed environment

### Requirement: Atomic environment and root validation before commit

Environment selection and root selection SHALL be validated together by the server before a project is committed. A project SHALL NOT be created when its environment rejects the chosen root, and a failed validation SHALL leave no partial project.

#### Scenario: Root rejected by the environment

- **WHEN** the chosen root is rejected by the selected environment
- **THEN** the project is not created and the failure is reported in the creation flow

### Requirement: Project Environments management routes

The client SHALL present a Project Environments route in both wide and narrow layouts, with search, a list, a detail view, the references that block removal, and Test, Edit, and Remove actions. Desktop native auxiliary routes and browser in-page routes SHALL issue the same semantic commands against the same server-owned state.

#### Scenario: Narrow layout management

- **WHEN** the route is opened in a narrow layout
- **THEN** search, list, detail, references, and the Test, Edit, and Remove actions remain available

#### Scenario: Both hosts share commands

- **WHEN** the same action is taken in the Desktop auxiliary route and the browser in-page route
- **THEN** both issue the same semantic command and observe the same server-owned state

### Requirement: Declarative provider form rendering

Provider forms SHALL be rendered entirely from bounded server-supplied schemas. The renderer SHALL support fields, sections and disclosures, asynchronously resolved selects, preset cards, conditional visibility, per-field validation with an error summary, progress reporting, and confirmations. The renderer SHALL NOT execute or render provider-supplied HTML or code, and SHALL NOT display stored secret values.

#### Scenario: Async select resolution

- **WHEN** a schema declares an asynchronously resolved select
- **THEN** the renderer requests its options from the server and reports a resolution failure in the form

#### Scenario: Conditional field visibility

- **WHEN** a schema declares a field conditional on another field's value
- **THEN** the field is shown or hidden as that value changes

#### Scenario: No provider code in the client

- **WHEN** a provider schema is rendered
- **THEN** no provider-supplied HTML or code is executed and no stored secret value is displayed

### Requirement: Read-only environment presentation on tabs and in the editor

Project tabs and the project editor SHALL show the project's provider and environment status subtly. That presentation SHALL be read-only: retargeting an existing project's environment SHALL NOT be offered as an editable control.

#### Scenario: Editor shows an immutable environment

- **WHEN** a project is edited
- **THEN** its environment and provider are shown and cannot be changed from the editor

### Requirement: Environment and extension surface accessibility

The project bar and the management routes SHALL meet the accessibility contract: correct `tablist` and `tab` semantics for projects, split-button and menu semantics with typeahead and managed focus, a mobile sheet presentation in narrow layouts, radio-card semantics for preset choices, live regions for progress, alerts for errors, interactive targets of at least 44 pixels on touch, forced-colour support, and reduced-motion support.

#### Scenario: Keyboard operation of the split button

- **WHEN** the split button is operated by keyboard
- **THEN** the primary action and the menu are both reachable, typeahead selects a menu item, and focus is returned predictably

#### Scenario: Touch target size

- **WHEN** the routes are rendered on a touch viewport
- **THEN** interactive targets are at least 44 pixels and the layout does not overflow horizontally
