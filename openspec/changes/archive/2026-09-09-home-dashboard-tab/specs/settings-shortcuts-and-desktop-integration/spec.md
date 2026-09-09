## ADDED Requirements

### Requirement: Show Dashboard command

**Show Dashboard** SHALL be a first-class application command that selects the Home dashboard in the focused workspace view. It SHALL appear in the View menu on Desktop and in the browser host's in-page menu, SHALL be searchable in the Command Bar, and SHALL be rebindable in the shortcut settings surface like every other command, with a default accelerator of `CmdOrCtrl+0`. It SHALL require no active panel and SHALL remain available when a workspace view holds no projects.

#### Scenario: Invoking the command

- **WHEN** a user invokes **Show Dashboard**
- **THEN** the focused workspace view selects the Home dashboard

#### Scenario: Default accelerator

- **WHEN** a user has not rebound the command
- **THEN** `CmdOrCtrl+0` invokes it and the shortcut settings surface shows it as the default

#### Scenario: No projects open

- **WHEN** a workspace view holds no projects
- **THEN** **Show Dashboard** is still available and still selects the Home dashboard

## MODIFIED Requirements

### Requirement: Command Bar contents

The Command Bar SHALL search built-in commands and saved macros. Built-ins SHALL honour the active panel and project requirement and SHALL display user-configured shortcuts. Commands that act on the workspace view rather than a panel, including **Show Dashboard**, SHALL remain available when no panel or project is active.

#### Scenario: Searching the Command Bar

- **WHEN** a user searches the Command Bar
- **THEN** built-in commands and saved macros are returned with their user-configured shortcuts shown

#### Scenario: Command requiring an active panel

- **WHEN** a built-in command requires an active panel or project that is not present
- **THEN** the command honours that requirement rather than running

#### Scenario: View-scoped command without an active panel

- **WHEN** a user runs **Show Dashboard** with no active panel
- **THEN** it runs rather than being withheld
