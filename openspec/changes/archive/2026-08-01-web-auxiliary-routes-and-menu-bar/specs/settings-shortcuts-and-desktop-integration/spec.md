## ADDED Requirements

### Requirement: Web route parity for menu and editing actions
Settings, Macros, Recordings, project-tab editing, and terminal-tab editing
SHALL be usable in a browser host with the same shared route bodies and the
same save, cancel, and conflict behaviour as the Desktop native windows. These
actions MUST NOT depend on host-injected preload globals.

#### Scenario: Saving settings from a browser host
- **WHEN** a user opens Settings in a browser host and saves a change
- **THEN** the change is persisted through the selected server's client and the
  in-page route closes with focus returned

#### Scenario: Project edit conflict in a browser host
- **WHEN** a project edit is saved against a stale revision in a browser host
- **THEN** the same conflict handling and focus restoration used by the Desktop
  project editor applies

#### Scenario: No preload dependency
- **WHEN** the browser workspace composition is inspected
- **THEN** it declares no native-windows capability and references no
  host-injected auxiliary preload global
